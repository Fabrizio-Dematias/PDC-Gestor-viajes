import { duracionAMinutos } from '../comun/amadeus.js'
import { consultarDuffel } from '../comun/duffel.js'

/**
 * Implementación de `ProveedorDeVuelos` contra la API real de Duffel
 * (https://duffel.com), evaluada en docs/proveedor-externo.md como
 * alternativa a Amadeus tras el cierre de su portal Self-Service.
 *
 * Todo el mapeo del formato de Duffel al del contrato vive acá adentro
 * — mismo aislamiento que la implementación de Amadeus: cambiar de
 * proveedor es escribir un archivo como este, nada más.
 *
 * `duracionAMinutos` se reusa de `comun/amadeus.js`: las dos APIs
 * devuelven la duración en el mismo formato ISO 8601 (`PT11H45M`), no
 * es nada específico de Amadeus.
 */
export function crearProveedorDuffel() {
  return {
    nombre: 'duffel',

    async buscar({ origen, destino, ida, vuelta, pasajeros }) {
      const slices = [{ origin: origen, destination: destino, departure_date: ida }]
      if (vuelta) slices.push({ origin: destino, destination: origen, departure_date: vuelta })

      const datos = await consultarDuffel('/air/offer_requests?return_offers=true', {
        slices,
        passengers: Array.from({ length: Math.max(Number(pasajeros) || 1, 1) }, () => ({ type: 'adult' })),
        cabin_class: 'economy',
      })

      return (datos?.offers ?? []).map((oferta) => {
        // Ida y vuelta vienen como dos slices separados en la misma
        // oferta; el contrato (§2) sólo tiene lugar para un tramo por
        // ítem, así que se muestra el de ida — mismo recorte que ya
        // hace la implementación de Amadeus.
        const tramoIda = oferta.slices?.[0]
        const segmentos = tramoIda?.segments ?? []
        const primero = segmentos.at(0)
        const ultimo = segmentos.at(-1)

        return {
          id: oferta.id,
          aerolinea: oferta.owner?.name ?? 'Sin identificar',
          codigo_aerolinea: oferta.owner?.iata_code ?? '??',
          origen: primero?.origin?.iata_code ?? origen,
          destino: ultimo?.destination?.iata_code ?? destino,
          salida: primero?.departing_at,
          llegada: ultimo?.arriving_at,
          duracion_min: duracionAMinutos(tramoIda?.duration),
          escalas: Math.max(segmentos.length - 1, 0),
          precio: {
            monto: Math.round(Number(oferta.total_amount ?? 0)),
            // A diferencia de Amadeus, Duffel no toma una moneda pedida
            // por parámetro — devuelve la que fije la aerolínea. El
            // formateador del front (`dominio/formato.js`) ya la toma
            // tal cual llega, sea cual sea.
            moneda: oferta.total_currency ?? 'USD',
          },
        }
      })
    },
  }
}
