import { escribir, leer, useAlmacen } from '../../estado/almacen.js'

/**
 * Estado de salud simulado de cada vertical. Es la perilla que se usa en
 * la defensa: sustituye a `docker stop hospedaje` mientras no haya
 * contenedores, y sirve para el caso que *no* se puede reproducir
 * apagando un contenedor — el servicio colgado.
 */
export const SALUD = {
  OK: 'ok',
  LENTO: 'lento',
  CAIDO: 'caido',
  COLGADO: 'colgado',
}

export const DESCRIPCION_SALUD = {
  [SALUD.OK]: 'Responde normal (300–900 ms)',
  [SALUD.LENTO]: 'Tarda 1,8 s — entra justo dentro del presupuesto',
  [SALUD.CAIDO]: 'Devuelve 503 al instante, como un contenedor apagado',
  [SALUD.COLGADO]: 'Acepta la conexión y nunca responde — lo corta el timeout',
}

const CLAVE = 'caos'
const POR_DEFECTO = { vuelos: SALUD.OK, hospedaje: SALUD.OK }

/**
 * Override por URL: `?caos=hospedaje:caido,vuelos:lento`.
 *
 * Sirve para dejar preparada una pestaña por escenario antes de la
 * defensa, en vez de tener que hacer clics mientras se explica. También
 * es lo que permite sacar capturas del estado de fallo sin intervención
 * manual.
 */
function aplicarOverrideDeUrl() {
  const crudo = new URLSearchParams(window.location.search).get('caos')
  if (!crudo) return
  const validos = new Set(Object.values(SALUD))
  const estado = { ...leer(CLAVE, POR_DEFECTO) }
  for (const par of crudo.split(',')) {
    const [vertical, salud] = par.split(':')
    if (vertical && validos.has(salud)) estado[vertical] = salud
  }
  escribir(CLAVE, estado)
}

if (typeof window !== 'undefined') aplicarOverrideDeUrl()

export function saludDe(vertical) {
  return leer(CLAVE, POR_DEFECTO)[vertical] ?? SALUD.OK
}

export function fijarSalud(vertical, salud) {
  escribir(CLAVE, { ...leer(CLAVE, POR_DEFECTO), [vertical]: salud })
}

export function useCaos() {
  return useAlmacen(CLAVE, POR_DEFECTO)
}
