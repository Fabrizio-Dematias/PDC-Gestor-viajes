/**
 * Datos ficticios de vuelos. Es la implementación "base propia" del
 * patrón ProveedorDeVuelos (Módulo 4): misma forma de salida que la
 * implementación Amadeus, cero dependencia de internet.
 */
const AEROLINEAS = [
  ['AR', 'Aerolíneas Argentinas'],
  ['IB', 'Iberia'],
  ['LA', 'LATAM'],
  ['AF', 'Air France'],
  ['TP', 'TAP Air Portugal'],
  ['AZ', 'ITA Airways'],
  ['CM', 'Copa Airlines'],
  ['AA', 'American Airlines'],
]

// Duración base ida, en minutos, desde Buenos Aires.
const DURACION_BASE = {
  MAD: 755, BCN: 790, FCO: 860, CDG: 815, LIS: 720,
  MIA: 570, JFK: 640, SCL: 125, GRU: 175, LIM: 290, MEX: 555, PUJ: 480,
}

function horas(fechaISO, hh, mm) {
  const d = new Date(`${fechaISO}T00:00:00Z`)
  d.setUTCHours(hh, mm, 0, 0)
  return d
}

export function generarVuelos({ origen = 'EZE', destino = 'MAD', ida, pasajeros = 1 }) {
  const base = DURACION_BASE[destino] ?? 600
  const fecha = ida || new Date().toISOString().slice(0, 10)

  return AEROLINEAS.map(([codigo, nombre], i) => {
    const escalas = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2
    const duracion = base + escalas * 155 + i * 12
    const salida = horas(fecha, (6 + i * 2) % 24, i % 2 ? 40 : 5)
    const llegada = new Date(salida.getTime() + duracion * 60_000)
    const precioPorPasajero =
      Math.round((base * 1450 + i * 41_000 - escalas * 96_000) / 1000) * 1000

    return {
      id: `${codigo}${1100 + i * 7}-${fecha}`,
      aerolinea: nombre,
      codigo_aerolinea: codigo,
      origen,
      destino,
      salida: salida.toISOString(),
      llegada: llegada.toISOString(),
      duracion_min: duracion,
      escalas,
      precio: {
        monto: Math.max(precioPorPasajero, 180_000) * pasajeros,
        moneda: 'ARS',
      },
    }
  }).sort((a, b) => a.precio.monto - b.precio.monto)
}
