import { CONFIG } from '../comun/config.js'
import { consultarAmadeus, duracionAMinutos } from '../comun/amadeus.js'

/**
 * Implementación de `ProveedorDeVuelos` contra la API real de Amadeus.
 *
 * Todo el mapeo del formato de Amadeus al del contrato vive acá adentro:
 * el servicio, el agregador y el front no saben que Amadeus existe. Ese
 * aislamiento es el punto del patrón — cambiar de proveedor es escribir
 * otro archivo como este, no tocar el resto.
 *
 * SIN PROBAR contra la API real: hace falta una cuenta de Amadeus. Ver
 * docs/proveedor-externo.md. Mientras tanto el vertical corre con el proveedor
 * ficticio, que es el valor por defecto.
 */
export function crearProveedorAmadeus() {
  return {
    nombre: 'amadeus',

    async buscar({ origen, destino, ida, vuelta, pasajeros }) {
      const datos = await consultarAmadeus('/v2/shopping/flight-offers', {
        originLocationCode: origen,
        destinationLocationCode: destino,
        departureDate: ida,
        ...(vuelta ? { returnDate: vuelta } : {}),
        adults: String(pasajeros),
        currencyCode: CONFIG.amadeus.moneda,
        max: '10',
      })

      const aerolineas = datos?.dictionaries?.carriers ?? {}

      return (datos?.data ?? []).map((oferta) => {
        const tramoIda = oferta.itineraries?.[0]
        const segmentos = tramoIda?.segments ?? []
        const primero = segmentos.at(0)
        const ultimo = segmentos.at(-1)
        const codigo = oferta.validatingAirlineCodes?.[0] ?? primero?.carrierCode

        return {
          id: `${oferta.id}-${ida}`,
          aerolinea: aerolineas[codigo] ?? codigo ?? 'Sin identificar',
          codigo_aerolinea: codigo ?? '??',
          origen: primero?.departure?.iataCode ?? origen,
          destino: ultimo?.arrival?.iataCode ?? destino,
          // Amadeus devuelve hora local del aeropuerto, sin zona. Se
          // pasa tal cual: normalizarla exige la zona horaria de cada
          // aeropuerto, y eso se resuelve cuando haya datos reales para
          // verificar contra qué.
          salida: primero?.departure?.at,
          llegada: ultimo?.arrival?.at,
          duracion_min: duracionAMinutos(tramoIda?.duration),
          escalas: Math.max(segmentos.length - 1, 0),
          precio: {
            monto: Math.round(Number(oferta.price?.total ?? 0)),
            moneda: oferta.price?.currency ?? CONFIG.amadeus.moneda,
          },
        }
      })
    },
  }
}
