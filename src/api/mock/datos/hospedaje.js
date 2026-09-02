/** Datos ficticios de hospedaje. Ver nota en datos/vuelos.js. */
const CIUDADES = {
  MAD: 'Madrid', BCN: 'Barcelona', FCO: 'Roma', CDG: 'París',
  LIS: 'Lisboa', MIA: 'Miami', JFK: 'Nueva York', SCL: 'Santiago',
  GRU: 'São Paulo', LIM: 'Lima', MEX: 'Ciudad de México', PUJ: 'Punta Cana',
}

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

function noches(ida, vuelta) {
  if (!ida || !vuelta) return 3
  const ms = new Date(vuelta) - new Date(ida)
  const n = Math.round(ms / 86_400_000)
  return n > 0 ? n : 3
}

export function generarHospedaje({ destino = 'MAD', ida, vuelta, pasajeros = 1 }) {
  const ciudad = CIUDADES[destino] ?? destino
  const n = noches(ida, vuelta)

  return PLANTILLAS.map(([nombre, estrellas, puntaje, opiniones, servicios], i) => ({
    id: `hot-${destino.toLowerCase()}-${String(i + 1).padStart(3, '0')}`,
    nombre: `${nombre} ${ciudad}`,
    ciudad,
    estrellas,
    puntaje,
    opiniones,
    servicios,
    noches: n,
    precio: {
      monto: (estrellas * 27_000 + i * 4_500 + (pasajeros - 1) * 12_000) * n,
      moneda: 'ARS',
    },
  })).sort((a, b) => b.puntaje - a.puntaje)
}
