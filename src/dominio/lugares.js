/**
 * Catálogo de lugares para el modo sin backend.
 *
 * Cuando hay backend, el catálogo real —70 aeropuertos y las 255 rutas
 * que existen de verdad— lo sirve el servicio de vuelos. Esta lista
 * corta es sólo para que el front se pueda usar solo, y coincide con lo
 * que sabe generar el servidor simulado.
 */
const AEROPUERTOS = [
  ['EZE', 'Buenos Aires · Ezeiza', 'Argentina'],
  ['AEP', 'Buenos Aires · Aeroparque', 'Argentina'],
  ['COR', 'Córdoba', 'Argentina'],
  ['MDZ', 'Mendoza', 'Argentina'],
  ['ROS', 'Rosario', 'Argentina'],
  ['MAD', 'Madrid', 'España'],
  ['BCN', 'Barcelona', 'España'],
  ['FCO', 'Roma', 'Italia'],
  ['CDG', 'París', 'Francia'],
  ['LIS', 'Lisboa', 'Portugal'],
  ['MIA', 'Miami', 'Estados Unidos'],
  ['JFK', 'Nueva York', 'Estados Unidos'],
  ['MEX', 'Ciudad de México', 'México'],
  ['PUJ', 'Punta Cana', 'República Dominicana'],
  ['SCL', 'Santiago', 'Chile'],
  ['GRU', 'São Paulo', 'Brasil'],
  ['LIM', 'Lima', 'Perú'],
]

const ORIGENES = ['EZE', 'AEP', 'COR', 'MDZ', 'ROS']
const DESTINOS = AEROPUERTOS.map(([iata]) => iata).filter((i) => !ORIGENES.includes(i))

export const CATALOGO_SIMULADO = {
  aeropuertos: AEROPUERTOS.map(([iata, ciudad, pais]) => ({ iata, ciudad, pais, nombre: ciudad })),
  origenes: ORIGENES,
  // Sin datos reales de rutas, cualquier origen llega a cualquier destino.
  rutas: Object.fromEntries(ORIGENES.map((o) => [o, DESTINOS])),
}

export function buscarAeropuerto(catalogo, iata) {
  return catalogo.aeropuertos.find((a) => a.iata === iata)
}

/** Sin acentos y en minúscula: quien escribe "cordoba" busca "Córdoba". */
export function normalizar(texto) {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

const empiezaAlguna = (frase, q) =>
  frase.split(/[\s·,\-/]+/).some((palabra) => palabra.startsWith(q))

/**
 * Puntaje de una coincidencia: cuanto más bajo, más arriba aparece.
 *
 * El orden importa más que el filtro. Escribir "cor" tiene que traer
 * Córdoba antes que Comodoro Rivadavia, y "esp" tiene que traer los
 * aeropuertos de España aunque ninguna ciudad se llame así.
 */
function puntaje(aeropuerto, q) {
  const iata = normalizar(aeropuerto.iata)
  const ciudad = normalizar(aeropuerto.ciudad)
  const pais = normalizar(aeropuerto.pais)
  const nombre = normalizar(aeropuerto.nombre)

  if (iata === q) return 0
  // Prefijo del código: quien escribe "ez" busca Ezeiza, no un
  // aeropuerto cuyo nombre contiene esas dos letras en el medio.
  if (iata.startsWith(q)) return 0.5
  if (ciudad.startsWith(q)) return 1
  if (pais.startsWith(q)) return 2
  if (empiezaAlguna(ciudad, q)) return 3
  if (empiezaAlguna(nombre, q)) return 4
  if (ciudad.includes(q)) return 5
  if (pais.includes(q)) return 6
  if (nombre.includes(q)) return 7
  return null
}

/**
 * Busca aeropuertos por ciudad, país, nombre o código.
 *
 * `permitidos` acota el universo: para el destino son los que tienen
 * vuelo directo desde el origen elegido. Los que coinciden con lo
 * escrito pero quedan fuera se devuelven aparte, para poder decirle al
 * usuario por qué no los ve en vez de esconderlos sin explicación.
 */
export function buscarLugares(catalogo, consulta, permitidos) {
  const q = normalizar(consulta)
  const habilitado = permitidos ? new Set(permitidos) : null
  const dentro = []
  const fuera = []

  for (const a of catalogo.aeropuertos) {
    const p = q ? puntaje(a, q) : 8
    if (p === null) continue
    ;(habilitado && !habilitado.has(a.iata) ? fuera : dentro).push({ ...a, _p: p })
  }

  dentro.sort((x, y) => x._p - y._p || x.ciudad.localeCompare(y.ciudad))
  return { coincidencias: dentro, descartadas: fuera.length }
}

export function etiquetaDe(catalogo, iata) {
  const a = buscarAeropuerto(catalogo, iata)
  if (!a) return iata
  return a.pais && a.pais !== 'Argentina' ? `${a.ciudad}, ${a.pais}` : a.ciudad
}
