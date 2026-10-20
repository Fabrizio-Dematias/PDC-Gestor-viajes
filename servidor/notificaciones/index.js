import { abrirBase } from '../comun/base.js'
import { CONFIG } from '../comun/config.js'
import { crearProveedorEmail } from '../comun/email.js'
import { crearServicio, ErrorHttp } from '../comun/http.js'
import { crearConsumidor } from '../comun/redis.js'

/**
 * Servicio de notificaciones — el consumidor del canal asíncrono
 * (Módulo 3).
 *
 * Cuando el agregador confirma una reserva publica un evento
 * (`reserva_confirmada`) en un stream de Redis y responde al usuario sin
 * esperar a nadie. Este servicio, que es un proceso aparte, lee esos
 * eventos de a uno, "manda" la confirmación y recién entonces los da por
 * entregados (XACK).
 *
 * ## Por qué asíncrono
 *
 * El aviso por email no puede frenar la reserva —el usuario ya consiguió
 * su asiento— ni hacerla fallar, y este servicio puede estar caído. Con
 * una cola en el medio, la reserva responde en milisegundos igual y los
 * avisos esperan en el stream hasta que el consumidor vuelva.
 *
 * ## Garantías
 *
 * - **Al menos una vez.** Un evento se confirma (XACK) *después* de
 *   procesarlo. Si el proceso muere o falla antes, el evento queda en la
 *   lista de pendientes del grupo y se reclama para reintentarlo
 *   (`reclamarPendientes`). Nunca se pierde un aviso; a veces se recibe
 *   dos veces. Perder un aviso es peor que recibirlo dos veces.
 * - **Consumidor idempotente.** La tabla de notificaciones usa el
 *   `reserva_id` como clave primaria: si el mismo evento llega otra vez
 *   (se publicó de nuevo, o falló el XACK después de enviar) se cuenta
 *   la repetición y no se manda otro mensaje. Combinar "al menos una
 *   vez" con deduplicación por un identificador explícito es lo que en
 *   la práctica se llama "exactamente una vez".
 *
 * Puede haber varios consumidores del mismo grupo: Redis reparte los
 * eventos entre ellos. Acá corre uno.
 */
const base = abrirBase(import.meta.url, 'notificaciones.db')
base.exec(`
  CREATE TABLE IF NOT EXISTS notificaciones (
    reserva_id   TEXT PRIMARY KEY,
    codigo       TEXT NOT NULL,
    email        TEXT,
    pasajeros    INTEGER,
    evento_id    TEXT,
    enviada_en   TEXT NOT NULL,
    repeticiones INTEGER NOT NULL DEFAULT 0
  );
`)

const proveedorEmail = crearProveedorEmail()
const espera = (ms) => new Promise((resolver) => setTimeout(resolver, ms))
let cerrando = false

/**
 * El consumidor se conecta a Redis en segundo plano y reintenta hasta
 * lograrlo: el servicio *arranca igual* (`/salud/live` responde) y
 * simplemente no está listo (`/salud/ready` da 503) hasta que Redis
 * contesta. Que un proceso esté vivo y que esté listo son preguntas
 * distintas (Módulo 4, health checks).
 */
let consumidor = null
async function conectarConReintento() {
  while (!consumidor && !cerrando) {
    try {
      consumidor = await crearConsumidor(`notif-${process.pid}`)
      console.log(`[notificaciones] consumidor del grupo "${CONFIG.colas.grupo}" sobre "${CONFIG.colas.stream}"`)
    } catch (error) {
      console.warn(`[notificaciones] Redis no responde (${error.message}): reintento en 2 s`)
      await espera(2000)
    }
  }
}

const guardar = base.prepare(`
  INSERT INTO notificaciones (reserva_id, codigo, email, pasajeros, evento_id, enviada_en)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (reserva_id) DO NOTHING
`)
const contarRepeticion = base.prepare('UPDATE notificaciones SET repeticiones = repeticiones + 1 WHERE reserva_id = ?')

const cuentas = { procesadas: 0, enviadas: 0, repetidas: 0, fallidas: 0 }
/** Falla simulada del consumidor, para mostrar el reintento
 *  (`PUT /demo/falla`). Se lanza *antes* de enviar nada. */
let fallaSimulada = false

/**
 * Procesa un evento. Es idempotente: lo que protege de mandar dos veces
 * es la clave primaria, no la memoria del proceso (que se pierde al
 * reiniciar).
 */
async function entregar(evento) {
  if (evento.tipo !== 'reserva_confirmada') return // un tipo que este servicio no entiende no es un error
  if (!evento.reserva_id) throw new Error('evento sin reserva_id')
  if (fallaSimulada) throw new Error('falla simulada del consumidor')

  const pasajeros = Number(evento.pasajeros) || 1
  const nueva = guardar.run(
    evento.reserva_id,
    evento.codigo,
    evento.email ?? null,
    pasajeros,
    evento.id,
    new Date().toISOString(),
  ).changes

  if (nueva === 1) {
    await proveedorEmail.enviarConfirmacionReserva({ email: evento.email, codigo: evento.codigo, pasajeros })
    cuentas.enviadas++
  } else {
    contarRepeticion.run(evento.reserva_id)
    cuentas.repetidas++
    console.log(`[notificaciones] ${evento.reserva_id}: ya estaba enviada, se descarta el duplicado`)
  }
}

async function manejar(evento) {
  try {
    await entregar(evento)
    await consumidor.confirmar(evento.id) // recién ahora sale de pendientes
    cuentas.procesadas++
  } catch (error) {
    cuentas.fallidas++
    // Sin XACK: queda pendiente y se reintenta solo.
    console.warn(`[notificaciones] ${evento.id} no se pudo procesar (${error.message}): queda pendiente, se reintenta`)
  }
}

/** Lee eventos nuevos; bloquea hasta un segundo esperando. */
async function bucleDeLectura() {
  while (!cerrando) {
    try {
      for (const evento of await consumidor.leer({ bloqueoMs: 1000 })) await manejar(evento)
    } catch (error) {
      if (cerrando) return
      console.error('[notificaciones] error leyendo la cola:', error.message)
      await espera(1000)
    }
  }
}

/** Reclama lo que quedó leído y sin confirmar (por una falla, o por un
 *  consumidor que murió a mitad de camino) y lo reintenta. */
async function bucleDeReintentos() {
  while (!cerrando) {
    await espera(CONFIG.colas.sondeoPendientesMs)
    try {
      const pendientes = await consumidor.reclamarPendientes({ minInactivoMs: CONFIG.colas.reclamarTrasMs })
      for (const evento of pendientes) await manejar(evento)
    } catch (error) {
      if (!cerrando) console.error('[notificaciones] error reclamando pendientes:', error.message)
    }
  }
}

conectarConReintento().then(() => {
  if (consumidor) {
    bucleDeLectura()
    bucleDeReintentos()
  }
})

const leerNotificacion = base.prepare('SELECT * FROM notificaciones WHERE reserva_id = ?')

crearServicio({
  nombre: 'notificaciones',
  puerto: CONFIG.notificaciones.puerto,

  // Listo = puede hablar con Redis, que es de donde saca el trabajo.
  listo: async () => {
    if (!consumidor) throw new Error('sin conexión a Redis')
    return { cola: await consumidor.estado() }
  },

  alCerrar: async () => {
    cerrando = true
    await consumidor?.cerrar()
  },

  rutas: {
    'GET /salud': async () => {
      const cola = (await consumidor?.estado().catch(() => null)) ?? { enCola: null, pendientes: null }
      return {
        servicio: 'notificaciones',
        proveedor_email: proveedorEmail.nombre,
        ...cuentas,
        ...cola,
        falla_simulada: fallaSimulada,
      }
    },

    /** ¿Ya salió el aviso de esta reserva? Lo consulta el agregador
     *  para que el usuario vea el estado en la pantalla de
     *  confirmación. */
    'GET /api/notificaciones/:reservaId': ({ params }) => {
      const n = leerNotificacion.get(params.reservaId)
      if (!n) throw new ErrorHttp(404, { error: 'todavía no se envió', motivo: 'pendiente' })
      return {
        reserva_id: n.reserva_id,
        estado: 'enviada',
        enviada_en: n.enviada_en,
        repeticiones: n.repeticiones,
      }
    },

    'GET /api/notificaciones': () =>
      base.prepare('SELECT * FROM notificaciones ORDER BY enviada_en DESC LIMIT 20').all(),

    // --- Demostración: el consumidor que falla, y el reintento. ---
    'GET /demo/falla': () => ({ activa: fallaSimulada }),
    'PUT /demo/falla': ({ cuerpo }) => {
      fallaSimulada = Boolean(cuerpo?.activa)
      console.log(`[notificaciones] falla simulada → ${fallaSimulada ? 'activa' : 'apagada'}`)
      return { activa: fallaSimulada }
    },
  },
})
