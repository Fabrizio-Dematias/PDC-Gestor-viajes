/**
 * Los vuelos de un viaje, de donde sea que vengan. Las pantallas de la
 * reserva (tarifas → datos → confirmación) se pasan el viaje por
 * `location.state`: antes un solo `vuelo`; ahora `vuelos`, uno por tramo
 * (ida y vuelta, multidestino). Se acepta también la forma vieja para no
 * romper un enlace o una pestaña abierta antes del cambio.
 *
 * Devuelve `null` si no hay un viaje completo: la pantalla que lo
 * recibe tiene que mandar de vuelta a los resultados.
 */
export function vuelosDe(state) {
  const lista = state?.vuelos ?? (state?.vuelo ? [state.vuelo] : [])
  return lista.length > 0 && lista.every(Boolean) ? lista : null
}

/** A la lista de resultados de la misma búsqueda, para "elegir otro". */
export function urlDeResultados(criterios) {
  const params = new URLSearchParams(
    Object.entries(criterios ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
  return params.size > 0 ? `/resultados?${params}` : '/resultados'
}
