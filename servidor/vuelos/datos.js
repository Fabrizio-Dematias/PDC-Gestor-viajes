import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Esquema y semilla de la base propia del servicio de vuelos.
 *
 * Los aeropuertos, las aerolíneas y las rutas son reales: salen del
 * subconjunto de OpenFlights que está en `servidor/datos-referencia/`
 * (ver el FUENTE.md de esa carpeta). Lo que se simula son los horarios y
 * los precios, que es justo lo que daría un proveedor externo.
 *
 * La tabla guarda *itinerarios* —una programación que se repite todos
 * los días, como la de cualquier aerolínea—, no vuelos con fecha. La
 * fecha la pone la consulta al componer salida y llegada.
 */

const referencia = (archivo) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../datos-referencia/${archivo}`, import.meta.url)), 'utf8'))

/** Hash estable: la misma ruta genera siempre los mismos horarios y
 *  precios, así la demostración no cambia entre arranques. */
function semilla(texto) {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

const VELOCIDAD_KMH = 800
/** Rodaje, despegue, ascenso, descenso y aproximación. */
const MINUTOS_FIJOS = 35

function duracion(km) {
  return Math.max(45, Math.round((km / VELOCIDAD_KMH) * 60 + MINUTOS_FIJOS))
}

/** ARS por pasajero. Base fija más un valor por kilómetro. */
function precio(km, variacion) {
  const bruto = 90_000 + km * 95
  return Math.round((bruto * (0.9 + variacion * 0.22)) / 1000) * 1000
}

export function crearEsquema(base) {
  base.exec(`
    CREATE TABLE IF NOT EXISTS aeropuertos (
      iata   TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      ciudad TEXT NOT NULL,
      pais   TEXT NOT NULL,
      zona   TEXT
    );

    CREATE TABLE IF NOT EXISTS itinerarios (
      id                TEXT    PRIMARY KEY,
      codigo_aerolinea  TEXT    NOT NULL,
      aerolinea         TEXT    NOT NULL,
      origen            TEXT    NOT NULL REFERENCES aeropuertos(iata),
      destino           TEXT    NOT NULL REFERENCES aeropuertos(iata),
      hora_salida       TEXT    NOT NULL,
      duracion_min      INTEGER NOT NULL,
      escalas           INTEGER NOT NULL,
      km                INTEGER NOT NULL,
      precio_base       INTEGER NOT NULL,
      moneda            TEXT    NOT NULL DEFAULT 'ARS'
    );
    CREATE INDEX IF NOT EXISTS idx_ruta ON itinerarios (origen, destino);
  `)
}

export function sembrar(base) {
  const { total } = base.prepare('SELECT COUNT(*) AS total FROM itinerarios').get()
  if (total > 0) return { insertados: 0, total }

  const aeropuertos = referencia('aeropuertos.json')
  const aerolineas = new Map(referencia('aerolineas.json').map((a) => [a.iata, a.nombre]))
  const rutas = referencia('rutas.json')

  const nuevoAeropuerto = base.prepare(
    'INSERT OR IGNORE INTO aeropuertos (iata, nombre, ciudad, pais, zona) VALUES (?, ?, ?, ?, ?)',
  )
  const nuevoItinerario = base.prepare(`
    INSERT INTO itinerarios
      (id, codigo_aerolinea, aerolinea, origen, destino, hora_salida,
       duracion_min, escalas, km, precio_base, moneda)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ARS')
  `)

  let insertados = 0
  base.exec('BEGIN')
  for (const a of aeropuertos) nuevoAeropuerto.run(a.iata, a.nombre, a.ciudad, a.pais, a.zona)

  for (const ruta of rutas) {
    const clave = `${ruta.aerolinea}${ruta.origen}${ruta.destino}`
    const h = semilla(clave)
    // Dos frecuencias diarias por ruta: alcanza para que la lista de
    // resultados tenga cuerpo sin inventar aerolíneas que no vuelan.
    for (let i = 0; i < 2; i++) {
      const hora = (h + i * 9) % 24
      const minuto = [0, 15, 30, 45][(h >> (3 + i)) % 4]
      nuevoItinerario.run(
        `${clave}-${i}`,
        ruta.aerolinea,
        aerolineas.get(ruta.aerolinea) ?? ruta.aerolinea,
        ruta.origen,
        ruta.destino,
        `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`,
        duracion(ruta.km),
        ruta.escalas,
        ruta.km,
        precio(ruta.km, ((h >> (7 + i)) % 100) / 100),
      )
      insertados++
    }
  }
  base.exec('COMMIT')
  return { insertados, total: insertados }
}
