import { CONFIG, SERVICIOS } from './config.js'
import { pedirJson } from './pedir.js'

/**
 * Descubrimiento de servicios, del lado del cliente (Módulo 4).
 *
 * Es la contraparte de `servidor/registro/`: allá viven las instancias
 * registradas y sus health checks; acá, el cliente que las usa.
 *
 * - `registrarServicio` — lo llama cada servicio al arrancar: se anota
 *   en el registro y lo renueva cada pocos segundos (el latido); al
 *   cerrarse se da de baja.
 * - `iniciarDescubrimiento` + `urlServicio` — lo usa quien necesita
 *   llamar a otro servicio (el agregador): un ciclo en segundo plano
 *   guarda la lista de instancias *sanas* y `urlServicio('vuelos')`
 *   responde con una, repartiendo por turnos entre las que haya.
 *
 * ## Por qué `urlServicio` es síncrona
 *
 * Preguntarle al registro en cada llamada sumaría un viaje de red al
 * camino de cada búsqueda. Se pregunta en segundo plano, cada 2 s, y
 * la respuesta sale de una copia en memoria: descubrir cuesta nada. El
 * precio es que la lista puede tener hasta ~2 s de antigüedad — una
 * instancia que acaba de caerse puede recibir todavía unos pedidos,
 * que fallan rápido y los absorben el timeout y el circuit breaker
 * (falacia 1 de la computación distribuida: la red no es confiable, y
 * el descubrimiento tampoco).
 *
 * ## Tres casos, y qué se hace en cada uno
 *
 * 1. **El registro responde y hay instancias sanas**: se usa una.
 * 2. **El registro responde y no hay ninguna sana** (todas `critico`):
 *    se lanza `SinInstancias`. Una instancia que dijo "no estoy lista"
 *    no debe recibir tráfico — para eso existe el health check.
 * 3. **El registro no responde** (o nunca oyó hablar de ese servicio):
 *    se usa la dirección fija de `config.js`. El registro es un
 *    refuerzo, no un requisito: sin él, el sistema funciona exactamente
 *    como antes de que existiera.
 */

const REFRESCO_MS = 2_000
/** Pasado este tiempo sin poder actualizar, la copia se considera
 *  vencida y se vuelve a las direcciones fijas. */
const VIGENCIA_MS = 15_000
const LATIDO_MS = 3_000

export class SinInstancias extends Error {
  constructor(nombre) {
    super(`no hay instancias listas de ${nombre}`)
    this.name = 'SinInstancias'
    this.motivo = 'sin_instancias'
    this.servicio = nombre
  }
}

/** nombre → { instancias: [{ id, url }], conocido, en } */
const copia = new Map()
const turnos = new Map()
/** url → hasta cuándo se la evita. Ver `conFailover`. */
const sospechosas = new Map()
const SOSPECHA_MS = 5_000
let registroAccesible = null // null: todavía no se sabe

function avisarEstadoDelRegistro(accesible) {
  if (accesible === registroAccesible) return
  if (registroAccesible !== null || !accesible) {
    console.log(
      accesible
        ? '[descubrimiento] registro de servicios disponible: se descubren instancias dinámicamente'
        : '[descubrimiento] el registro de servicios no responde: se usan las direcciones de config.js',
    )
  }
  registroAccesible = accesible
}

/**
 * Dónde llamar a `nombre`. Reparte por turnos entre las instancias
 * sanas (round-robin); ver el comentario de arriba para los tres casos.
 */
export function urlServicio(nombre) {
  const fija = CONFIG[nombre]?.url
  const entrada = copia.get(nombre)
  const vigente = entrada && Date.now() - entrada.en < VIGENCIA_MS

  if (!vigente || !entrada.conocido) {
    if (!fija) throw new Error(`servicio desconocido: ${nombre}`)
    return fija
  }
  if (entrada.instancias.length === 0) throw new SinInstancias(nombre)

  // Las que acaban de fallar se saltean un rato; si fallaron todas, se
  // prueba con todas (más vale intentar que no llamar a nadie).
  const ahora = Date.now()
  const sanas = entrada.instancias.filter((i) => (sospechosas.get(i.url) ?? 0) < ahora)
  const candidatas = sanas.length > 0 ? sanas : entrada.instancias

  const turno = turnos.get(nombre) ?? 0
  turnos.set(nombre, turno + 1)
  return candidatas[turno % candidatas.length].url
}

/**
 * Failover del lado del cliente: ejecuta `llamar(urlBase)` contra una
 * instancia y, si falla porque **no se pudo conectar** (se cayó, la
 * conexión se rechazó o se reseteó), lo reintenta una vez contra otra.
 *
 * Hace falta porque el registro tarda unos segundos en enterarse de que
 * una instancia murió (su próximo health check) y los clientes otros
 * tantos en refrescar la lista: durante esa ventana, la mitad de los
 * pedidos seguiría yendo a la instancia muerta. Medido sin esto, con dos
 * instancias de vuelos y una caída en seco: 4 de 8 búsquedas fallaron
 * hasta que el registro se enteró. Con esto, ninguna — a lo sumo una
 * demora de milisegundos por el intento fallido.
 *
 * Detalles que importan:
 * - Sólo se reintenta ante `motivo: 'error'` (no se pudo conectar), **no**
 *   ante un timeout: ahí ya se gastó el presupuesto de tiempo del
 *   usuario, y la instancia puede haber procesado el pedido.
 * - La instancia que falló queda "sospechosa" unos segundos
 *   (`reportarFallo`): el siguiente pedido ni la prueba. Es *outlier
 *   detection* pasivo, el complemento del health check activo.
 * - Sólo para operaciones que se pueden repetir sin efecto doble: las
 *   búsquedas (de lectura) y la reserva (que lleva su `Idempotency-Key`).
 */
export async function conFailover(nombre, llamar) {
  const base = urlServicio(nombre)
  try {
    return await llamar(base)
  } catch (error) {
    if (error?.motivo !== 'error') throw error
    sospechosas.set(base, Date.now() + SOSPECHA_MS)
    let otra
    try {
      otra = urlServicio(nombre)
    } catch {
      throw error
    }
    if (otra === base) throw error
    console.warn(`[descubrimiento] ${nombre}: ${base} no responde, se reintenta en ${otra}`)
    return llamar(otra)
  }
}

/** Instancias que el cliente tiene hoy en su copia, para `/salud`. */
export function instanciasConocidas() {
  return Object.fromEntries(
    [...copia.entries()].map(([nombre, { instancias, en }]) => [
      nombre,
      { instancias: instancias.map((i) => i.url), actualizado_hace_ms: Date.now() - en },
    ]),
  )
}

export const registroDisponible = () => registroAccesible === true

async function refrescar(nombres) {
  try {
    const { ok, datos } = await pedirJson(`${CONFIG.registro.url}/api/v1/servicios?solo_sanas=true`, {
      timeoutMs: 1000,
    })
    if (!ok || !datos?.servicios) throw new Error('respuesta no ok')
    const ahora = Date.now()
    for (const nombre of nombres) {
      const lista = datos.servicios[nombre]
      copia.set(nombre, { instancias: lista ?? [], conocido: lista !== undefined, en: ahora })
    }
    avisarEstadoDelRegistro(true)
  } catch {
    avisarEstadoDelRegistro(false)
  }
}

/** Arranca el ciclo que mantiene al día la lista de instancias. */
export function iniciarDescubrimiento(nombres = SERVICIOS) {
  if (process.env.REGISTRO === 'off') return
  refrescar(nombres)
  setInterval(() => refrescar(nombres), REFRESCO_MS).unref()
}

/**
 * Se anota en el registro y lo renueva (latido). Devuelve `{ baja }`
 * para darse de baja al cerrar. Si el registro no responde no pasa
 * nada: se reintenta en el próximo latido, y el servicio sigue
 * atendiendo igual.
 */
export function registrarServicio({ nombre, puerto, version }) {
  if (process.env.REGISTRO === 'off') return { baja: async () => {} }

  const id = process.env.INSTANCIA_ID ?? `${nombre}@${puerto}`
  // Dentro de Docker Compose la dirección que ven los demás no es
  // `localhost`, sino el nombre del servicio: se fija con URL_PROPIA.
  const url = process.env.URL_PROPIA ?? `http://localhost:${puerto}`
  const ruta = `${CONFIG.registro.url}/api/v1/servicios/${nombre}/${encodeURIComponent(id)}`

  let anotado = null
  const latir = async () => {
    try {
      const { ok } = await pedirJson(ruta, { metodo: 'PUT', cuerpo: { url, version }, timeoutMs: 1000 })
      if (!ok) throw new Error('el registro rechazó el latido')
      if (anotado !== true) console.log(`[${nombre}] registrado como ${id} en el registro de servicios`)
      anotado = true
    } catch {
      if (anotado !== false) console.log(`[${nombre}] el registro de servicios no responde: se reintenta en cada latido`)
      anotado = false
    }
  }
  latir()
  const temporizador = setInterval(latir, LATIDO_MS)
  temporizador.unref()

  return {
    id,
    baja: async () => {
      clearInterval(temporizador)
      try {
        await pedirJson(ruta, { metodo: 'DELETE', timeoutMs: 500 })
      } catch {
        // si no se puede, el TTL del registro la saca sola
      }
    },
  }
}
