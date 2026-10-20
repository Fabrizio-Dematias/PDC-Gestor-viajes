import { duracionAMinutos } from '../comun/amadeus.js'
import { consultarDuffel } from '../comun/duffel.js'
import { utcDesdeLocal } from '../comun/lugares.js'

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

/**
 * Duffel manda las horas como reloj local del aeropuerto, sin huso
 * (`2026-11-20T14:42:00`). El contrato dice otra cosa (docs/contrato-
 * agregador.md §2): hora de reloj del aeropuerto, escrita con `Z`, y el
 * front la muestra tal cual con `timeZone: 'UTC'`. Sin la `Z`, el
 * navegador interpreta el texto como hora *suya* y la corre por su
 * propio huso: un vuelo de las 14:42 se veía a las 17:42 en Argentina.
 */
const comoRelojConZ = (texto) => {
  if (!texto) return texto
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(texto) ? texto : `${texto}Z`
}

/** Minutos reales entre la salida y la llegada de una serie de tramos,
 *  cada hora en el huso de su aeropuerto. Respaldo para cuando Duffel no
 *  informa la duración del viaje: un 0 se vería como "0 min" en pantalla. */
function minutosDe(segmentos) {
  const primero = segmentos.at(0)
  const ultimo = segmentos.at(-1)
  const sale = utcDesdeLocal(primero?.origin?.iata_code, Date.parse(comoRelojConZ(primero?.departing_at)))
  const llega = utcDesdeLocal(ultimo?.destination?.iata_code, Date.parse(comoRelojConZ(ultimo?.arriving_at)))
  return Number.isFinite(sale) && Number.isFinite(llega) ? Math.max(Math.round((llega - sale) / 60_000), 0) : 0
}

function segmentosDe(segmentos) {
  return segmentos.map((s, i) => {
    const siguiente = segmentos[i + 1]
    let espera
    if (siguiente) {
      // La espera real entre dos vuelos se mide en UTC: los dos
      // horarios están en el huso de aeropuertos distintos.
      const llega = utcDesdeLocal(s.destination?.iata_code, Date.parse(comoRelojConZ(s.arriving_at)))
      const sale = utcDesdeLocal(siguiente.origin?.iata_code, Date.parse(comoRelojConZ(siguiente.departing_at)))
      if (Number.isFinite(llega) && Number.isFinite(sale)) espera = Math.max(Math.round((sale - llega) / 60_000), 0)
    }
    return {
      origen: s.origin?.iata_code,
      destino: s.destination?.iata_code,
      salida: comoRelojConZ(s.departing_at),
      llegada: comoRelojConZ(s.arriving_at),
      duracion_min: duracionAMinutos(s.duration) || minutosDe([s]),
      aerolinea: s.marketing_carrier?.name ?? s.operating_carrier?.name ?? 'Sin identificar',
      codigo_aerolinea: s.marketing_carrier?.iata_code ?? s.operating_carrier?.iata_code ?? '??',
      ...(espera !== undefined ? { espera_min: espera } : {}),
      // Llega a un aeropuerto y el próximo vuelo sale de otro (de la misma
      // ciudad): lo avisa la pantalla, el traslado es por cuenta del pasajero.
      ...(siguiente && siguiente.origin?.iata_code !== s.destination?.iata_code ? { cambio_aeropuerto: true } : {}),
    }
  })
}

export function crearProveedorDuffel() {
  return {
    nombre: 'duffel',

    /**
     * Qué códigos mandarle a Duffel por cada lugar. Una ciudad con
     * código metropolitano oficial (`BUE`) se pide entera, en una sola
     * búsqueda: Duffel entiende códigos de ciudad y arma él todas las
     * combinaciones de sus aeropuertos. Verificado contra la API real:
     * `BUE→MAD` devuelve las ofertas de Ezeiza *y* de Aeroparque.
     * Las demás van por aeropuerto, los de más tráfico primero y con un
     * tope — cada búsqueda a Duffel cuesta entre 1,5 y 3,5 s.
     */
    expandir(lugar) {
      if (lugar.tipo === 'ciudad' && lugar.codigo !== lugar.principal) return [lugar.codigo]
      return lugar.aeropuertos.slice(0, 2)
    },

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
        // hace la implementación de Amadeus. (El front pide la vuelta
        // como una búsqueda aparte, destino→origen, así que no se
        // pierde nada.)
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
          salida: comoRelojConZ(primero?.departing_at),
          llegada: comoRelojConZ(ultimo?.arriving_at),
          duracion_min: duracionAMinutos(tramoIda?.duration) || minutosDe(segmentos),
          escalas: Math.max(segmentos.length - 1, 0),
          precio: {
            monto: Math.round(Number(oferta.total_amount ?? 0)),
            // A diferencia de Amadeus, Duffel no toma una moneda pedida
            // por parámetro — devuelve la que fije la aerolínea. El
            // formateador del front (`dominio/formato.js`) ya la toma
            // tal cual llega, sea cual sea.
            moneda: oferta.total_currency ?? 'USD',
          },
          // Sólo con escalas: para un directo el segmento sería el
          // propio ítem.
          ...(segmentos.length > 1 ? { segmentos: segmentosDe(segmentos) } : {}),
        }
      })
    },
  }
}
