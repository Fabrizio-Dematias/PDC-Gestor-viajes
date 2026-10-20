import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CIUDADES_ES } from './traducciones-ciudades.mjs'

/**
 * Genera `ciudades.json`: las ciudades (áreas metropolitanas) del
 * catálogo, a partir de `aeropuertos.json` y `rutas.json`.
 *
 *   node servidor/datos-referencia/ciudades.mjs
 *
 * Es offline y determinista (no baja nada, a diferencia de
 * `generar.mjs`), así que se puede volver a correr cuando se quiera.
 *
 * ## Por qué existe
 *
 * El buscador trabajaba con aeropuertos sueltos. Una ciudad con más de
 * uno —Buenos Aires tiene Ezeiza y Aeroparque— aparecía dos veces con
 * el mismo nombre y no había forma de decir "desde cualquier aeropuerto
 * de Buenos Aires": quien elegía el primero (Aeroparque) no encontraba
 * Madrid, porque desde ahí no sale ningún vuelo intercontinental. Un
 * viajero piensa en ciudades; los aeropuertos son un detalle que se
 * decide después.
 *
 * ## Cómo se agrupa
 *
 * Mismo país + mismo nombre de ciudad + a menos de `RADIO_KM` entre sí
 * (encadenado). La distancia importa porque hay 98 nombres de ciudad
 * repetidos en el dataset y muchos son homónimos lejanos (Londres de
 * Canadá y Londres de Reino Unido, o las dos Deer Lake de Canadá, a
 * 2570 km): sólo por nombre se fusionarían ciudades que no tienen nada
 * que ver.
 *
 * Alcanza con eso para casi todo; los pocos casos donde el nombre no
 * coincide pero el viajero los trata como una sola ciudad
 * (Newark ↔ Nueva York, Campinas ↔ São Paulo) están en `FUSIONES`.
 *
 * ## Código de ciudad
 *
 * Una ciudad se identifica por un código de tres letras, igual que un
 * aeropuerto, para que los dos viajen por los mismos parámetros
 * (`origen=BUE` o `origen=EZE`). Cuando existe el código metropolitano
 * oficial de IATA (BUE, LON, NYC…) se usa ése — es el que Duffel
 * entiende, así que se puede pasar tal cual. Si no, la ciudad usa el
 * código de su aeropuerto principal: para una ciudad de un solo
 * aeropuerto (casi todas) el código de ciudad y el de aeropuerto son el
 * mismo y nada de lo que ya existía cambia.
 */

const RADIO_KM = 120

/** Código metropolitano oficial de IATA, indexado por cualquiera de los
 *  aeropuertos de la ciudad. Sólo se usa si no pisa el código de un
 *  aeropuerto real (SHA es a la vez Shanghái-Hongqiao y el código de la
 *  ciudad: ahí gana el aeropuerto). */
const METRO_IATA = {
  EZE: 'BUE', AEP: 'BUE',
  LHR: 'LON', LGW: 'LON', STN: 'LON', LTN: 'LON', LCY: 'LON',
  CDG: 'PAR', ORY: 'PAR',
  JFK: 'NYC', LGA: 'NYC', EWR: 'NYC',
  IAD: 'WAS', DCA: 'WAS',
  ORD: 'CHI', MDW: 'CHI',
  SVO: 'MOW', DME: 'MOW', VKO: 'MOW',
  FCO: 'ROM', CIA: 'ROM',
  MXP: 'MIL', LIN: 'MIL', BGY: 'MIL',
  HND: 'TYO', NRT: 'TYO',
  KIX: 'OSA', ITM: 'OSA',
  ICN: 'SEL', GMP: 'SEL',
  PEK: 'BJS', PKX: 'BJS', NAY: 'BJS',
  GRU: 'SAO', CGH: 'SAO', VCP: 'SAO',
  GIG: 'RIO', SDU: 'RIO',
  YYZ: 'YTO', YTZ: 'YTO',
  YUL: 'YMQ', YMX: 'YMQ',
  ARN: 'STO', BMA: 'STO', NYO: 'STO',
  TXL: 'BER', SXF: 'BER',
  CGK: 'JKT', HLP: 'JKT',
}

/** Aeropuertos que el viajero trata como parte de otra ciudad aunque
 *  OpenFlights los ubique en otro nombre. [aeropuerto, aeropuerto de la
 *  ciudad a la que se suma]. */
const FUSIONES = [
  ['EWR', 'JFK'], // Newark, a 25 km de Manhattan: se vende como Nueva York
  ['BGY', 'MXP'], // Bergamo, "Milán Bergamo" para las low cost
  ['VCP', 'GRU'], // Viracopos (Campinas), el tercer aeropuerto de São Paulo
  ['BVA', 'CDG'], // "París Beauvais"
]

/** Nombre corto con el que se conocen los aeropuertos de las ciudades
 *  que tienen varios; el resto usa el nombre de OpenFlights sin la
 *  palabra "Airport"/"International". Sirve para que dos entradas de la
 *  misma ciudad se distingan a simple vista (Ezeiza vs. Aeroparque). */
const ALIAS = {
  EZE: 'Ezeiza', AEP: 'Aeroparque',
  LHR: 'Heathrow', LGW: 'Gatwick', STN: 'Stansted', LTN: 'Luton', LCY: 'London City',
  CDG: 'Charles de Gaulle', ORY: 'Orly', BVA: 'Beauvais',
  JFK: 'John F. Kennedy', LGA: 'LaGuardia', EWR: 'Newark Liberty',
  IAD: 'Dulles', DCA: 'Reagan Nacional',
  ORD: "O'Hare", MDW: 'Midway',
  SVO: 'Sheremétievo', DME: 'Domodédovo', VKO: 'Vnukovo',
  FCO: 'Fiumicino', CIA: 'Ciampino',
  MXP: 'Malpensa', LIN: 'Linate', BGY: 'Bérgamo',
  HND: 'Haneda', NRT: 'Narita',
  KIX: 'Kansai', ITM: 'Itami',
  ICN: 'Incheon', GMP: 'Gimpo',
  PEK: 'Capital', PKX: 'Daxing', NAY: 'Nanyuan',
  PVG: 'Pudong', SHA: 'Hongqiao',
  GRU: 'Guarulhos', CGH: 'Congonhas', VCP: 'Viracopos',
  GIG: 'Galeão', SDU: 'Santos Dumont',
  YYZ: 'Pearson', YTZ: 'Billy Bishop',
  YUL: 'Trudeau', YMX: 'Mirabel',
  ARN: 'Arlanda', BMA: 'Bromma', NYO: 'Skavsta',
  TXL: 'Tegel', SXF: 'Schönefeld',
  IST: 'Estambul', SAW: 'Sabiha Gökçen',
  DXB: 'Dubái Internacional', DWC: 'Al Maktoum',
  IAH: 'George Bush', HOU: 'Hobby',
  DFW: 'Dallas-Fort Worth', DAL: 'Love Field',
  BKK: 'Suvarnabhumi', DMK: 'Don Mueang',
  DEN: 'Denver Internacional',
  MAD: 'Barajas',
  LAX: 'Los Ángeles Internacional',
  MIA: 'Miami Internacional',
  BCN: 'El Prat',
}

/** Nombres de ciudad que sólo difieren en el idioma o en un acento y
 *  que hay que juntar antes de agrupar. */
const NOMBRE_POR_AEROPUERTO = {
  SCQ: 'Santiago de Compostela', // sin esto choca con Santiago de Chile
}

const dir = fileURLToPath(new URL('.', import.meta.url))
const leer = (archivo) => JSON.parse(readFileSync(`${dir}${archivo}`, 'utf8'))

const aeropuertos = leer('aeropuertos.json')
const rutas = leer('rutas.json')

// --- Tráfico: cuántas rutas toca cada aeropuerto. Ordena sugerencias y
// decide cuál es el aeropuerto principal de cada ciudad.
const trafico = new Map()
for (const r of rutas) {
  trafico.set(r.origen, (trafico.get(r.origen) ?? 0) + 1)
  trafico.set(r.destino, (trafico.get(r.destino) ?? 0) + 1)
}

const rad = Math.PI / 180
function km(a, b) {
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(x))
}

const sinAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Se re-aplica el diccionario por si `aeropuertos.json` se generó con
// una versión anterior de las traducciones: es idempotente.
const lista = aeropuertos.map((a) => ({
  ...a,
  ciudad: NOMBRE_POR_AEROPUERTO[a.iata] ?? CIUDADES_ES[a.ciudad] ?? a.ciudad,
  trafico: trafico.get(a.iata) ?? 0,
}))
const porIata = new Map(lista.map((a) => [a.iata, a]))

// --- Agrupar: unión-búsqueda sobre (país, nombre) + cercanía.
const padre = new Map(lista.map((a) => [a.iata, a.iata]))
const raiz = (x) => {
  while (padre.get(x) !== x) {
    padre.set(x, padre.get(padre.get(x)))
    x = padre.get(x)
  }
  return x
}
const unir = (a, b) => padre.set(raiz(a), raiz(b))

const grupos = new Map()
for (const a of lista) {
  const clave = `${a.pais}|${sinAcentos(a.ciudad)}`
  if (!grupos.has(clave)) grupos.set(clave, [])
  grupos.get(clave).push(a)
}
for (const miembros of grupos.values()) {
  for (let i = 0; i < miembros.length; i++) {
    for (let j = i + 1; j < miembros.length; j++) {
      if (km(miembros[i], miembros[j]) <= RADIO_KM) unir(miembros[i].iata, miembros[j].iata)
    }
  }
}
for (const [a, b] of FUSIONES) if (porIata.has(a) && porIata.has(b)) unir(a, b)

const clusters = new Map()
for (const a of lista) {
  const r = raiz(a.iata)
  if (!clusters.has(r)) clusters.set(r, [])
  clusters.get(r).push(a)
}

// --- Nombre corto de aeropuerto.
function nombreCorto(a) {
  if (ALIAS[a.iata]) return ALIAS[a.iata]
  return a.nombre
    .replace(/\b(International|Intl\.?|Regional|Municipal|Airport|Airfield|Aerodrome|Aeropuerto|Aeroporto)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,–-]+$/g, '')
    .trim() || a.nombre
}

const codigosDeAeropuerto = new Set(lista.map((a) => a.iata))

const ciudades = []
for (const miembros of clusters.values()) {
  miembros.sort((a, b) => b.trafico - a.trafico || a.iata.localeCompare(b.iata))
  const principal = miembros[0]

  // Código metropolitano: sólo si hay otro aeropuerto con vuelos que
  // lo justifique y el código no es de un aeropuerto real.
  const conVuelos = miembros.filter((m) => m.trafico > 0)
  const metro = miembros.map((m) => METRO_IATA[m.iata]).find(Boolean)
  const usaMetro = metro && conVuelos.length > 1 && !codigosDeAeropuerto.has(metro)

  ciudades.push({
    codigo: usaMetro ? metro : principal.iata,
    nombre: principal.ciudad,
    pais: principal.pais,
    principal: principal.iata,
    rutas: miembros.reduce((s, m) => s + m.trafico, 0),
    zona: miembros.find((m) => m.zona)?.zona ?? null,
    lat: Number(principal.lat.toFixed(4)),
    lon: Number(principal.lon.toFixed(4)),
    aeropuertos: miembros.map((m) => ({
      iata: m.iata,
      nombre: nombreCorto(m),
      oficial: m.nombre,
      rutas: m.trafico,
    })),
  })
}

// Los más transitados primero: es el orden con el que desempata el
// buscador cuando varias ciudades coinciden con lo escrito.
ciudades.sort((a, b) => b.rutas - a.rutas || a.nombre.localeCompare(b.nombre))

// Un código de ciudad tiene que ser único (y no pisar un aeropuerto de
// otra ciudad): si no, `?destino=XXX` sería ambiguo.
const vistos = new Map()
for (const c of ciudades) {
  if (vistos.has(c.codigo)) throw new Error(`código de ciudad repetido: ${c.codigo} (${c.nombre} / ${vistos.get(c.codigo)})`)
  vistos.set(c.codigo, c.nombre)
}
for (const c of ciudades) {
  for (const a of c.aeropuertos) {
    if (vistos.has(a.iata) && vistos.get(a.iata) !== c.nombre) {
      // Un aeropuerto cuyo código es también el código de otra ciudad.
      throw new Error(`el aeropuerto ${a.iata} (${c.nombre}) pisa el código de la ciudad ${vistos.get(a.iata)}`)
    }
  }
}

writeFileSync(`${dir}ciudades.json`, `[\n${ciudades.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`)

const multi = ciudades.filter((c) => c.aeropuertos.length > 1)
const conVuelos = ciudades.filter((c) => c.rutas > 0)
console.log(`ciudades.json: ${ciudades.length} ciudades de ${aeropuertos.length} aeropuertos`)
console.log(`  con vuelos: ${conVuelos.length} · con varios aeropuertos: ${multi.length} · con código metropolitano: ${ciudades.filter((c) => c.codigo !== c.principal).length}`)
for (const c of multi.slice(0, 14)) {
  console.log(`  ${c.codigo} ${c.nombre}, ${c.pais}: ${c.aeropuertos.map((a) => `${a.iata} ${a.nombre} (${a.rutas})`).join(' · ')}`)
}
