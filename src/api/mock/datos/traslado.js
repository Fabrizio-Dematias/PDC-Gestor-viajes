/** Datos ficticios de traslado. Ver nota en datos/vuelos.js. Mismos
 *  tipos de vehículo que siembra `servidor/traslado/datos.js`, para que
 *  el modo front-solo no se note distinto. */
const TIPOS = [
  ['tra-compartido', 'Traslados Directo', 'Traslado compartido', 4, 6_500],
  ['tra-privado', 'CityTransfer', 'Auto privado', 3, 14_000],
  ['tra-van', 'AeroVan', 'Van ejecutiva', 8, 22_000],
  ['tra-taxi', 'Traslados Directo', 'Taxi aeropuerto', 4, 9_500],
]

function indice(ciudad) {
  let h = 2166136261
  for (let i = 0; i < ciudad.length; i++) {
    h ^= ciudad.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return 0.7 + ((Math.abs(h) % 100) / 100) * 0.9
}

export function generarTraslado({ destino = 'MAD', pasajeros = 1 }) {
  const i = indice(destino)
  return TIPOS.filter(([, , , capacidad]) => capacidad >= pasajeros)
    .map(([id, proveedor, vehiculo, capacidad, precioBase]) => ({
      id: `${id}-${destino.toLowerCase()}`,
      proveedor,
      vehiculo,
      capacidad,
      precio: { monto: Math.round((precioBase * i) / 500) * 500, moneda: 'ARS' },
    }))
    .sort((a, b) => a.precio.monto - b.precio.monto)
}
