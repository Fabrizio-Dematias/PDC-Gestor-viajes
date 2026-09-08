import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Esquema y semilla de la base propia del servicio de traslado
 * (aeropuerto ↔ ciudad de destino).
 *
 * Las ciudades salen del mismo catálogo de aeropuertos que usan vuelos
 * y hospedaje (`servidor/datos-referencia/`): un traslado siempre llega
 * a un destino real. El catálogo de vehículos, su capacidad y su precio
 * son simulados — no hay ninguna fuente abierta de tarifas de traslado,
 * y es justo el dato que vendería un proveedor externo (mismo criterio
 * que ya usan hospedaje y vuelos para lo comercial).
 */

const TIPOS = [
  ['compartido', 'Traslado compartido', 4, 6_500],
  ['privado', 'Auto privado', 3, 14_000],
  ['van', 'Van ejecutiva', 8, 22_000],
  ['taxi', 'Taxi aeropuerto', 4, 9_500],
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
    CREATE TABLE IF NOT EXISTS opciones (
      id         TEXT    PRIMARY KEY,
      proveedor  TEXT    NOT NULL,
      vehiculo   TEXT    NOT NULL,
      capacidad  INTEGER NOT NULL,
      precio_base INTEGER NOT NULL,
      moneda     TEXT    NOT NULL DEFAULT 'ARS'
    );
    CREATE TABLE IF NOT EXISTS ciudades (
      destino_iata TEXT PRIMARY KEY,
      ciudad       TEXT NOT NULL,
      indice       REAL NOT NULL
    );
  `)
}

const PROVEEDORES = ['Traslados Directo', 'CityTransfer', 'AeroVan', 'Traslados Directo']

export function sembrar(base) {
  const { total } = base.prepare('SELECT COUNT(*) AS total FROM opciones').get()
  if (total === 0) {
    const insertar = base.prepare(`
      INSERT INTO opciones (id, proveedor, vehiculo, capacidad, precio_base)
      VALUES (?, ?, ?, ?, ?)
    `)
    base.exec('BEGIN')
    TIPOS.forEach(([id, vehiculo, capacidad, precioBase], i) => {
      insertar.run(`tra-${id}`, PROVEEDORES[i], vehiculo, capacidad, precioBase)
    })
    base.exec('COMMIT')
  }

  const { total: totalCiudades } = base.prepare('SELECT COUNT(*) AS total FROM ciudades').get()
  if (totalCiudades > 0) return { insertados: 0, total: totalCiudades }

  const aeropuertos = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../datos-referencia/aeropuertos.json', import.meta.url)),
      'utf8',
    ),
  )
  const insertarCiudad = base.prepare(
    'INSERT OR IGNORE INTO ciudades (destino_iata, ciudad, indice) VALUES (?, ?, ?)',
  )
  base.exec('BEGIN')
  for (const a of aeropuertos) {
    // Mismo truco que hospedaje: un índice estable por ciudad, en un
    // rango plausible, sin pretender que sea un dato real.
    const indice = 0.7 + ((semilla(a.ciudad) % 100) / 100) * 0.9
    insertarCiudad.run(a.iata, a.ciudad, indice)
  }
  base.exec('COMMIT')
  return { insertados: aeropuertos.length, total: aeropuertos.length }
}
