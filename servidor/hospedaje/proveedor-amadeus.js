import { CONFIG } from '../comun/config.js'
import { consultarAmadeus } from '../comun/amadeus.js'

/**
 * Implementación de `ProveedorDeHospedaje` contra Amadeus.
 *
 * Hospedaje necesita dos llamadas donde vuelos necesitaba una: primero
 * qué hoteles hay en la ciudad, después qué ofertas tienen para esas
 * fechas. Las dos comparten el presupuesto de tiempo del vertical, así
 * que en la práctica este proveedor es bastante más frágil que el de
 * vuelos — motivo de más para que la interfaz permita volver al
 * proveedor ficticio con una variable de entorno.
 *
 * SIN PROBAR contra la API real. Ver docs/proveedor-externo.md.
 */
export function crearProveedorAmadeus() {
  return {
    nombre: 'amadeus',

    async buscar({ destino, ida, vuelta, noches, pasajeros }) {
      const listado = await consultarAmadeus('/v1/reference-data/locations/hotels/by-city', {
        cityCode: destino,
        radius: '20',
        radiusUnit: 'KM',
        hotelSource: 'ALL',
      })

      const ids = (listado?.data ?? []).slice(0, 20).map((h) => h.hotelId).filter(Boolean)
      if (ids.length === 0) return []

      const ofertas = await consultarAmadeus('/v3/shopping/hotel-offers', {
        hotelIds: ids.join(','),
        adults: String(pasajeros),
        checkInDate: ida,
        checkOutDate: vuelta,
        currency: CONFIG.amadeus.moneda,
        bestRateOnly: 'true',
      })

      return (ofertas?.data ?? []).map((entrada) => {
        const hotel = entrada.hotel ?? {}
        const precio = entrada.offers?.[0]?.price ?? {}
        const estrellas = Number(hotel.rating) || 3

        return {
          id: hotel.hotelId ?? entrada.id,
          nombre: hotel.name ?? 'Alojamiento sin nombre',
          ciudad: hotel.cityCode ?? destino,
          estrellas,
          // Amadeus no devuelve puntaje ni cantidad de opiniones en este
          // endpoint: están en /v2/e-reputation/hotel-sentiments, que es
          // una tercera llamada. Por ahora se deriva de las estrellas y
          // se marca con 0 opiniones para que quede claro que es un dato
          // que todavía no viene de la fuente.
          puntaje: Number((estrellas * 1.8).toFixed(1)),
          opiniones: 0,
          servicios: (hotel.amenities ?? []).slice(0, 5).map((s) => s.toLowerCase()),
          noches,
          precio: {
            monto: Math.round(Number(precio.total ?? 0)),
            moneda: precio.currency ?? CONFIG.amadeus.moneda,
          },
        }
      })
    },
  }
}
