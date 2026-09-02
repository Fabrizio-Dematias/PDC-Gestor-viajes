import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Esquema y semilla de la base propia del servicio de hospedaje.
 *
 * Las ciudades y los países son reales: salen del mismo subconjunto de
 * OpenFlights que usa el servicio de vuelos (`servidor/datos-referencia/`).
 * Cada destino con aeropuerto tiene alojamientos.
 *
 * Los nombres de los hoteles, las puntuaciones y los precios son
 * inventados: no hay ninguna fuente abierta de inventario hotelero, y es
 * justo el dato que vendería un proveedor externo.
 */

const PLANTILLAS = [
  ['Hotel Centro Histórico', 4, 8.6, 1204, ['wifi', 'desayuno', 'aire']],
  ['Gran Hotel Plaza', 5, 9.1, 2871, ['wifi', 'desayuno', 'pileta', 'spa', 'gimnasio']],
  ['Apart Ribera', 3, 8.0, 512, ['wifi', 'cocina']],
  ['Hostal del Puerto', 2, 7.4, 338, ['wifi']],
  ['Boutique Alameda', 4, 8.9, 921, ['wifi', 'desayuno', 'bar']],
  ['Residencia Universitaria', 2, 7.1, 190, ['wifi', 'cocina', 'lavandería']],
  ['Hotel Estación Norte', 3, 7.9, 664, ['wifi', 'desayuno', 'estacionamiento']],
  ['Suites Mirador', 5, 9.4, 1533, ['wifi', 'desayuno', 'pileta', 'spa', 'vista']],
]

function semilla(texto) {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function crearEsquema(base) {
  base.exec(`
    CREATE TABLE IF NOT EXISTS alojamientos (
      id            TEXT    PRIMARY KEY,
      nombre        TEXT    NOT NULL,
      ciudad        TEXT    NOT NULL,
      pais          TEXT    NOT NULL,
      ciudad_iata   TEXT    NOT NULL,
      estrellas     INTEGER NOT NULL,
      puntaje       REAL    NOT NULL,
      opiniones     INTEGER NOT NULL,
      servicios     TEXT    NOT NULL,
      precio_noche  INTEGER NOT NULL,
      moneda        TEXT    NOT NULL DEFAULT 'ARS'
    );
    CREATE INDEX IF NOT EXISTS idx_ciudad ON alojamientos (ciudad_iata);
  `)
}

export function sembrar(base) {
  const { total } = base.prepare('SELECT COUNT(*) AS total FROM alojamientos').get()
  if (total > 0) return { insertados: 0, total }

  const aeropuertos = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../datos-referencia/aeropuertos.json', import.meta.url)),
      'utf8',
    ),
  )

  const insertar = base.prepare(`
    INSERT INTO alojamientos
      (id, nombre, ciudad, pais, ciudad_iata, estrellas, puntaje, opiniones,
       servicios, precio_noche, moneda)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ARS')
  `)

  let insertados = 0
  base.exec('BEGIN')
  for (const a of aeropuertos) {
    // Índice de precio por ciudad: estable, y en un rango plausible.
    // Es inventado, como todo lo comercial de esta base.
    const indice = 0.6 + ((semilla(a.ciudad) % 100) / 100) * 1.0

    PLANTILLAS.forEach(([nombre, estrellas, puntaje, opiniones, servicios], i) => {
      insertar.run(
        `hot-${a.iata.toLowerCase()}-${String(i + 1).padStart(3, '0')}`,
        `${nombre} ${a.ciudad}`,
        a.ciudad,
        a.pais,
        a.iata,
        estrellas,
        puntaje,
        opiniones,
        JSON.stringify(servicios),
        Math.round(((estrellas * 27_000 + i * 4_500) * indice) / 500) * 500,
      )
      insertados++
    })
  }
  base.exec('COMMIT')
  return { insertados, total: insertados }
}
