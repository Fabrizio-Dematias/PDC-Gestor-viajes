import { createClient } from 'redis'
import { CONFIG } from './config.js'

/**
 * Redis del nodo central: circuit breaker, caché de última respuesta
 * buena (docs/contrato-agregador.md §5, "cuarto caso") y la cola de
 * eventos de reservas (más abajo).
 *
 * Es un mecanismo **secundario**: si Redis no responde, el agregador
 * tiene que seguir funcionando sin breaker y sin caché (contrato §9).
 * Para que eso sea cierto, un comando sin conexión tiene que fallar *al
 * instante*, no esperar:
 *
 * - `disableOfflineQueue`: por defecto node-redis, si no está
 *   conectado, deja los comandos en una cola esperando que vuelva la
 *   conexión. Con Redis caído eso significaba que cada búsqueda se
 *   quedaba ~5 s esperando (el agregador "fallaba abierto", sí, pero
 *   recién después de gastar el presupuesto entero del front). Medido:
 *   la búsqueda no volvía en 8 s. Sin cola, el comando se rechaza ya.
 * - La conexión se intenta en segundo plano y se reintenta sola; no
 *   hay que esperarla en el camino de ninguna request.
 * - `conRedis` además acota cada operación en el tiempo, por si la
 *   conexión parece viva y Redis está colgado.
 */
const cliente = createClient({
  url: CONFIG.redis.url,
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 1000,
    // Reintenta siempre, con espera creciente hasta 5 s.
    reconnectStrategy: (intentos) => Math.min(200 * 2 ** intentos, 5000),
  },
})

// Un error por cambio de estado, no uno por cada reintento: con Redis
// apagado una hora se imprimirían miles de líneas iguales.
let conectado = false
cliente.on('error', (error) => {
  if (conectado || conectado === null) return
  conectado = null
  console.error(`[redis] sin conexión (${error.code ?? error.message ?? 'error'}): se sigue sin caché ni breaker y se reintenta solo`)
})
cliente.on('ready', () => {
  if (conectado === null) console.log('[redis] conexión recuperada')
  conectado = true
})
cliente.on('end', () => {
  conectado = false
})

let arrancada = false
function arrancarConexion() {
  if (arrancada) return
  arrancada = true
  cliente.connect().catch((error) => {
    // Con `reconnectStrategy` no debería rechazar; si lo hace, se vuelve
    // a intentar en la próxima llamada.
    arrancada = false
    console.error('[redis] no se pudo conectar:', error.message)
  })
}
arrancarConexion()

const LIMITE_OPERACION_MS = 800

/** Ejecuta una operación contra Redis o falla enseguida: nunca espera
 *  a que vuelva la conexión. */
async function conRedis(operacion) {
  if (!cliente.isReady) {
    arrancarConexion()
    throw new Error('redis no está conectado')
  }
  let temporizador
  try {
    return await Promise.race([
      operacion(cliente),
      new Promise((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new Error('redis tardó demasiado')), LIMITE_OPERACION_MS)
      }),
    ])
  } finally {
    clearTimeout(temporizador)
  }
}

/** La caché es **por búsqueda**: `huella` identifica los criterios
 *  (origen, destino, fechas, pasajeros). Antes la clave era sólo
 *  agencia+vertical, así que con el circuito abierto se podían mostrar,
 *  con el cartel de "datos de hace X minutos", los hoteles de Madrid
 *  como respuesta a una búsqueda en Tokio. */
const claveCache = (agenciaId, vertical, huella) => `cache:${agenciaId}:${vertical}:${huella}`
const claveFallos = (agenciaId, vertical) => `breaker:fallos:${agenciaId}:${vertical}`
const claveAbierto = (agenciaId, vertical) => `breaker:abierto:${agenciaId}:${vertical}`

/** Guarda la última respuesta buena de una búsqueda de un vertical, por agencia. */
export function cacheGuardar(agenciaId, vertical, huella, items) {
  const valor = JSON.stringify({ items, generado_en: Date.now() })
  return conRedis((c) => c.set(claveCache(agenciaId, vertical, huella), valor, { PX: CONFIG.cache.ttlMs }))
}

/** `null` si no hay caché vigente; si no, los items y su antigüedad. */
export async function cacheLeer(agenciaId, vertical, huella) {
  const crudo = await conRedis((c) => c.get(claveCache(agenciaId, vertical, huella)))
  if (!crudo) return null
  const { items, generado_en } = JSON.parse(crudo)
  return { items, edadMs: Date.now() - generado_en }
}

/** ¿El circuito está abierto para este vertical, en esta agencia? */
export async function breakerAbierto(agenciaId, vertical) {
  return (await conRedis((c) => c.exists(claveAbierto(agenciaId, vertical)))) === 1
}

/**
 * Un fallo más. Si se llega al umbral dentro de la ventana, abre el
 * circuito por `breaker.abiertoMs` — durante ese tiempo no se vuelve a
 * llamar al vertical, así se deja de pagar el timeout completo en cada
 * búsqueda mientras el servicio está caído (docs/entrega-0... mecanismo 4).
 */
export async function breakerRegistrarFallo(agenciaId, vertical) {
  const clave = claveFallos(agenciaId, vertical)
  const fallos = await conRedis((c) => c.incr(clave))
  if (fallos === 1) await conRedis((c) => c.pExpire(clave, CONFIG.breaker.ventanaFalloMs))
  if (fallos >= CONFIG.breaker.fallosParaAbrir) {
    await conRedis((c) => c.set(claveAbierto(agenciaId, vertical), '1', { PX: CONFIG.breaker.abiertoMs }))
    console.warn(`[breaker] ${vertical}/${agenciaId} → circuito abierto (${fallos} fallos seguidos)`)
  }
}

/** Un éxito resetea el contador de fallos — vuelve a empezar la ventana. */
export async function breakerRegistrarExito(agenciaId, vertical) {
  await conRedis((c) => c.del(claveFallos(agenciaId, vertical)))
}

// ---------------------------------------------------------------------
// Canal asíncrono: cola de eventos de reservas sobre Redis Streams
// (Módulo 3). Un stream es un log persistente: lo que se publica queda
// guardado hasta que alguien lo lea y lo confirme, aunque el consumidor
// esté caído al momento de publicarlo — que es exactamente la propiedad
// que hace falta (el aviso de una reserva no puede frenar ni perderse
// por una caída del servicio que lo envía).
//
//   productor ──XADD──▶ reservas:eventos ◀──XREADGROUP── consumidor
//                                              │
//                                              └─XACK─▶ (recién acá se da por entregado)
//
// Garantía de entrega: **al menos una vez**. Un mensaje leído y no
// confirmado se queda en la lista de pendientes del grupo y se
// reintenta (`reclamarPendientes`); por eso el consumidor tiene que ser
// idempotente (servidor/notificaciones/). "Exactamente una vez" no se
// puede garantizar sólo con la red: se aproxima combinando "al menos
// una vez" con deduplicación por un identificador explícito.
// ---------------------------------------------------------------------

/** Redis sólo guarda strings en los campos de un evento. */
const aCampos = (obj) =>
  Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
  )

/**
 * Crea el grupo de consumidores si no existe. `0` = desde el principio
 * del stream: si hay eventos publicados antes de que el primer
 * consumidor haya arrancado nunca, son de este grupo y se procesan —
 * con `$` quedarían afuera y se perderían. MKSTREAM crea el stream
 * vacío si hace falta.
 *
 * También lo llama el productor antes de publicar: con el consumidor
 * apagado desde siempre, el grupo tiene que existir igual para que los
 * eventos cuenten como "esperando en la cola" (`lag`) y no como
 * huérfanos.
 */
async function asegurarGrupo(c) {
  try {
    await c.xGroupCreate(CONFIG.colas.stream, CONFIG.colas.grupo, '0', { MKSTREAM: true })
  } catch (error) {
    if (!String(error?.message).includes('BUSYGROUP')) throw error
  }
}

let grupoAsegurado = false

/**
 * Publica un evento. Lo único que el productor espera es que Redis lo
 * haya recibido (XADD): no espera a que nadie lo procese. El stream se
 * recorta a ~10 000 entradas para no crecer sin límite.
 */
export function publicarEvento(evento) {
  return conRedis(async (c) => {
    if (!grupoAsegurado) {
      await asegurarGrupo(c)
      grupoAsegurado = true
    }
    return c.xAdd(CONFIG.colas.stream, '*', aCampos(evento), {
      TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 10_000 },
    })
  })
}

/**
 * Un consumidor del grupo. Usa **dos conexiones propias**: una lectura
 * bloqueante (XREADGROUP BLOCK) deja la conexión ocupada hasta que
 * llegue algo, y si compartiera conexión con la confirmación
 * (XACK) o con el reclamo de pendientes, esos comandos esperarían a que
 * termine el bloqueo. Y ninguna es la conexión compartida del proceso,
 * que atiende lo demás.
 */
export async function crearConsumidor(nombre) {
  const { stream, grupo } = CONFIG.colas
  const lectora = cliente.duplicate()
  const auxiliar = cliente.duplicate()
  for (const c of [lectora, auxiliar]) {
    // Un aviso por corte, no uno por reintento.
    let avisado = false
    c.on('error', (error) => {
      if (avisado) return
      avisado = true
      console.error(`[redis:consumidor] sin conexión (${error.code ?? error.message ?? 'error'}): se reintenta solo`)
    })
    c.on('ready', () => {
      if (avisado) console.log('[redis:consumidor] conexión recuperada')
      avisado = false
    })
    await c.connect()
  }
  await asegurarGrupo(auxiliar)

  const comoEvento = ({ id, message }) => ({ id, ...message })

  /** Si Redis se reinició sin datos, el grupo ya no existe (NOGROUP): se
   *  vuelve a crear y se sigue, en vez de fallar para siempre. */
  async function recreandoElGrupo(operacion) {
    try {
      return await operacion()
    } catch (error) {
      if (!String(error?.message).includes('NOGROUP')) throw error
      await asegurarGrupo(auxiliar)
      return null
    }
  }

  return {
    /** Mensajes nuevos para este consumidor; espera hasta `bloqueoMs`. */
    async leer({ bloqueoMs = 1000, cantidad = 10 } = {}) {
      const respuesta = await recreandoElGrupo(() =>
        lectora.xReadGroup(grupo, nombre, { key: stream, id: '>' }, { COUNT: cantidad, BLOCK: bloqueoMs }),
      )
      return (respuesta?.[0]?.messages ?? []).map(comoEvento)
    },

    /** Mensajes que alguien leyó y nunca confirmó (consumidor caído o
     *  fallo a mitad de camino), inactivos hace más de `minInactivoMs`:
     *  pasan a este consumidor para reintentarlos. */
    async reclamarPendientes({ minInactivoMs, cantidad = 10 }) {
      const respuesta = await recreandoElGrupo(() =>
        auxiliar.xAutoClaim(stream, grupo, nombre, minInactivoMs, '0-0', { COUNT: cantidad }),
      )
      return (respuesta?.messages ?? []).filter(Boolean).map(comoEvento)
    },

    /** Recién acá el mensaje se da por entregado y sale de pendientes. */
    confirmar: (id) => auxiliar.xAck(stream, grupo, id),

    /** Cuántos eventos esperan y cuántos están leídos pero sin confirmar. */
    async estado() {
      const grupos = await auxiliar.xInfoGroups(stream)
      const g = grupos.find((x) => x.name === grupo)
      return { enCola: g?.lag ?? 0, pendientes: g?.pending ?? 0 }
    },

    cerrar: () => Promise.all([lectora.quit(), auxiliar.quit()]).catch(() => {}),
  }
}

/** Estado de la cola visto desde el productor (lo usa `/salud`). */
export async function estadoDeCola() {
  const grupos = await conRedis((c) => c.xInfoGroups(CONFIG.colas.stream)).catch(() => [])
  const g = grupos.find((x) => x.name === CONFIG.colas.grupo)
  return { stream: CONFIG.colas.stream, grupo: CONFIG.colas.grupo, enCola: g?.lag ?? 0, pendientes: g?.pending ?? 0 }
}
