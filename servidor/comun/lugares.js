import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Catálogo de lugares compartido por los servicios: aeropuertos y las
 * ciudades que los agrupan (`servidor/datos-referencia/ciudades.mjs`
 * explica cómo se arman).
 *
 * Es dato de referencia estático, igual que `aeropuertos.json` —no
 * cambia en tiempo de ejecución— y por eso lo puede leer cada servicio
 * sin pedírselo a otro: no rompe la regla de "cada servicio es dueño de
 * sus datos", que habla de datos que cambian.
 *
 * Un *lugar* es lo que viaja en `origen`/`destino`: un código de tres
 * letras que puede ser de un aeropuerto (`EZE`) o de una ciudad
 * (`BUE`, que incluye Ezeiza y Aeroparque). Para casi todas las
 * ciudades —las de un solo aeropuerto— los dos códigos son el mismo.
 */
const referencia = (archivo) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../datos-referencia/${archivo}`, import.meta.url)), 'utf8'))

const CIUDADES = referencia('ciudades.json')
const AEROPUERTOS = referencia('aeropuertos.json')

const ciudadPorCodigo = new Map(CIUDADES.map((c) => [c.codigo, c]))
const ciudadPorAeropuerto = new Map()
for (const c of CIUDADES) for (const a of c.aeropuertos) ciudadPorAeropuerto.set(a.iata, c)
const aeropuertoPorIata = new Map(AEROPUERTOS.map((a) => [a.iata, a]))

export const ciudades = () => CIUDADES
export const aeropuerto = (iata) => aeropuertoPorIata.get(iata)
export const ciudadDeAeropuerto = (iata) => ciudadPorAeropuerto.get(iata)

/** ¿Hay alguna ruta en el dataset que toque este aeropuerto? Es la
 *  respuesta por defecto para un proveedor que no sabe cuáles opera
 *  (Duffel: lo decide su API, no nosotros — esto sólo evita ofrecer
 *  Torrejón o Cuatro Vientos, que no tienen servicio regular). */
export const tieneVuelosEnDataset = (iata) =>
  (ciudadPorAeropuerto.get(iata)?.aeropuertos.find((a) => a.iata === iata)?.rutas ?? 0) > 0

/**
 * `codigo` → el lugar que representa, o `null` si no existe.
 *
 * - Un aeropuerto devuelve sólo a sí mismo (`aeropuertos: [iata]`): si
 *   alguien pide `EZE` quiere Ezeiza, no Buenos Aires entera.
 * - Una ciudad devuelve todos sus aeropuertos, el principal primero.
 *   Si la ciudad tiene un solo aeropuerto los dos significados
 *   coinciden y da igual cuál se haya pedido.
 *
 * `tieneVuelos` (opcional) filtra los aeropuertos de una ciudad a los
 * que operan: hospedaje y traslado no lo necesitan, vuelos sí — sin
 * esto buscaría vuelos en Torrejón y Cuatro Vientos, que no tienen
 * ninguno.
 */
export function resolverLugar(codigo, { tieneVuelos } = {}) {
  const clave = String(codigo ?? '').toUpperCase()
  const ciudad = ciudadPorCodigo.get(clave)
  if (ciudad) {
    const todos = ciudad.aeropuertos.map((a) => a.iata)
    const utiles = tieneVuelos ? todos.filter(tieneVuelos) : todos
    return {
      codigo: ciudad.codigo,
      tipo: 'ciudad',
      ciudad,
      principal: ciudad.principal,
      aeropuertos: utiles.length > 0 ? utiles : [ciudad.principal],
    }
  }
  const delAeropuerto = ciudadPorAeropuerto.get(clave)
  if (delAeropuerto) {
    return { codigo: clave, tipo: 'aeropuerto', ciudad: delAeropuerto, principal: clave, aeropuertos: [clave] }
  }
  return null
}

/**
 * Huso horario de un aeropuerto. 556 de los 6071 del dataset no lo
 * traen: ahí se estima por longitud (15° = 1 h), que no es exacto pero
 * deja la hora a una de la real, y sólo pasa en aeropuertos chicos.
 */
export function zonaDe(iata) {
  return aeropuertoPorIata.get(iata)?.zona ?? null
}

const formateadores = new Map()

/** Desfase de `zona` respecto de UTC, en minutos, en el instante `ms`
 *  (respeta horario de verano). */
export function offsetMinutos(iata, ms) {
  const zona = zonaDe(iata)
  if (!zona) {
    const lon = aeropuertoPorIata.get(iata)?.lon ?? 0
    return Math.round(lon / 15) * 60
  }
  let f = formateadores.get(zona)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formateadores.set(zona, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return Math.round((comoUtc - Math.floor(ms / 1000) * 1000) / 60_000)
}

/** Hora de reloj del aeropuerto (milisegundos "como si fueran UTC") →
 *  el instante real en UTC. Dos pasadas por si cae cerca de un cambio
 *  de horario. */
export function utcDesdeLocal(iata, localMs) {
  const primero = localMs - offsetMinutos(iata, localMs) * 60_000
  return localMs - offsetMinutos(iata, primero) * 60_000
}

/** Instante UTC → hora de reloj del aeropuerto, en el mismo formato. */
export function localDesdeUtc(iata, utcMs) {
  return utcMs + offsetMinutos(iata, utcMs) * 60_000
}

const RADIO = 6371
const rad = Math.PI / 180

/** Distancia en km entre dos aeropuertos, o `null` si falta alguno. */
export function distanciaKm(iataA, iataB) {
  const a = aeropuertoPorIata.get(iataA)
  const b = aeropuertoPorIata.get(iataB)
  if (!a || !b) return null
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return Math.round(RADIO * 2 * Math.asin(Math.sqrt(x)))
}
