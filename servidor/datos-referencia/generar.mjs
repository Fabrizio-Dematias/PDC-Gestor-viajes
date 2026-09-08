import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Regenera aeropuertos.json / aerolineas.json / rutas.json a partir del
 * dataset COMPLETO de OpenFlights (7698 aeropuertos, 67 663 rutas en
 * todo el mundo), no del recorte con origen en Argentina que había
 * antes. Se corre una sola vez y a mano — no forma parte del arranque
 * de ningún servicio (ver `servidor/comun/base.js`: los servicios sólo
 * leen estos JSON, nunca la fuente original).
 *
 *   node servidor/datos-referencia/generar.mjs
 *
 * Produce los tres archivos con **la misma forma exacta** que ya leían
 * `servidor/vuelos/datos.js` y `servidor/hospedaje/datos.js`, así que
 * ese código no cambia: sólo cambian los datos.
 */

const BASE = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data'

/** Parser CSV mínimo: campos entre comillas (con comas adentro) o sin
 *  comillas, separados por coma. Alcanza para el formato de OpenFlights. */
function parsearLinea(linea) {
  const campos = []
  let actual = ''
  let entreComillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"'
        i++
      } else if (c === '"') {
        entreComillas = false
      } else {
        actual += c
      }
    } else if (c === '"') {
      entreComillas = true
    } else if (c === ',') {
      campos.push(actual)
      actual = ''
    } else {
      actual += c
    }
  }
  campos.push(actual)
  return campos
}

async function descargar(archivo) {
  const res = await fetch(`${BASE}/${archivo}`)
  if (!res.ok) throw new Error(`no se pudo bajar ${archivo}: HTTP ${res.status}`)
  const texto = await res.text()
  return texto.split('\n').filter(Boolean).map(parsearLinea)
}

const nulo = (v) => (v === '\\N' || v === undefined ? '' : v)

/** Distancia en km entre dos puntos, fórmula del semiverseno — igual
 *  que se usaba para el recorte chico. */
function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)))
}

// ---------------------------------------------------------------------
// Traducciones. Países: mapa completo. Ciudades: OpenFlights las
// publica en inglés y sin diacríticos; traducir las ~7000 una por una
// no es viable a mano, así que se corrige sólo un conjunto de capitales
// y ciudades muy conocidas (exónimos españoles + reposición de acentos
// en topónimos de origen español/portugués). El resto queda tal cual
// viene. Esta frontera se documenta en FUENTE.md.
import { PAISES_ES } from './traducciones-paises.mjs'
import { CIUDADES_ES } from './traducciones-ciudades.mjs'

function traducirPais(pais) {
  return PAISES_ES[pais] ?? pais
}
function traducirCiudad(ciudad) {
  return CIUDADES_ES[ciudad] ?? ciudad
}

// ---------------------------------------------------------------------

console.log('Descargando airports.dat, airlines.dat, routes.dat de OpenFlights…')
const [filasAeropuertos, filasAerolineas, filasRutas] = await Promise.all([
  descargar('airports.dat'),
  descargar('airlines.dat'),
  descargar('routes.dat'),
])
console.log(
  `Descargado: ${filasAeropuertos.length} aeropuertos, ${filasAerolineas.length} aerolíneas, ${filasRutas.length} rutas (crudo)`,
)

const IATA_AEROPUERTO = /^[A-Z]{3}$/
const IATA_AEROLINEA = /^[A-Z0-9]{2}$/

const aeropuertos = []
const aeropuertosPorIata = new Map()
for (const f of filasAeropuertos) {
  const [, nombre, ciudad, pais, iata, , lat, lon, , , , zona, tipo] = f
  if (!IATA_AEROPUERTO.test(iata) || tipo !== 'airport') continue
  if (aeropuertosPorIata.has(iata)) continue // algún IATA duplicado en la fuente
  const entrada = {
    iata,
    nombre,
    ciudad: traducirCiudad(nulo(ciudad) || nombre),
    pais: traducirPais(pais),
    lat: Number(lat),
    lon: Number(lon),
    zona: nulo(zona) || null,
  }
  aeropuertos.push(entrada)
  aeropuertosPorIata.set(iata, entrada)
}

const aerolineas = []
const aerolineasPorIata = new Set()
for (const f of filasAerolineas) {
  const [, nombre, , iata, , , , activa] = f
  if (activa !== 'Y' || !IATA_AEROLINEA.test(iata) || aerolineasPorIata.has(iata)) continue
  aerolineasPorIata.add(iata)
  aerolineas.push({ iata, nombre })
}

const rutas = []
const vistas = new Set()
for (const f of filasRutas) {
  const [aerolinea, , origen, , destino, , , escalas] = f
  if (!aerolineasPorIata.has(aerolinea)) continue
  const a = aeropuertosPorIata.get(origen)
  const b = aeropuertosPorIata.get(destino)
  if (!a || !b || origen === destino) continue
  const clave = `${aerolinea}${origen}${destino}`
  if (vistas.has(clave)) continue // codeshares duplicados con el mismo par
  vistas.add(clave)
  rutas.push({
    aerolinea,
    origen,
    destino,
    escalas: Number(escalas) || 0,
    km: distanciaKm(a.lat, a.lon, b.lat, b.lon),
  })
}

console.log(
  `Filtrado: ${aeropuertos.length} aeropuertos, ${aerolineas.length} aerolíneas, ${rutas.length} rutas`,
)

// aeropuertos.json no lleva lat/lon en el archivo original (sólo lo usa
// este script para las distancias); se mantienen igual porque
// `servidor/vuelos/datos.js` y `servidor/hospedaje/datos.js` sólo leen
// iata/nombre/ciudad/pais/zona, así que no rompe nada tenerlas de más.
const dir = fileURLToPath(new URL('.', import.meta.url))
writeFileSync(`${dir}aeropuertos.json`, JSON.stringify(aeropuertos))
writeFileSync(`${dir}aerolineas.json`, JSON.stringify(aerolineas))
writeFileSync(`${dir}rutas.json`, JSON.stringify(rutas))
console.log('Listo: aeropuertos.json, aerolineas.json, rutas.json regenerados.')
