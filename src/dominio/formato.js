const FORMATEADORES = new Map()

export function formatearPrecio({ monto, moneda }) {
  if (!FORMATEADORES.has(moneda)) {
    FORMATEADORES.set(
      moneda,
      new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: moneda,
        maximumFractionDigits: 0,
      }),
    )
  }
  return FORMATEADORES.get(moneda).format(monto)
}

/** "hace 3 minutos", para el aviso de datos cacheados. */
export function antiguedad(timestamp) {
  const seg = Math.round((Date.now() - timestamp) / 1000)
  if (seg < 60) return 'hace menos de un minuto'
  const min = Math.round(seg / 60)
  if (min < 60) return `hace ${min} ${min === 1 ? 'minuto' : 'minutos'}`
  const hs = Math.round(min / 60)
  return `hace ${hs} ${hs === 1 ? 'hora' : 'horas'}`
}

/**
 * Las horas de un vuelo (`salida`, `llegada`) son el reloj del
 * aeropuerto escrito con `Z` (docs/contrato-agregador.md §2): se leen
 * como UTC a propósito, para mostrar los mismos números sin que el
 * huso del navegador los corra.
 */
export function horaDeReloj(iso) {
  if (!iso) return '--:--'
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
}

/** Cuántos días de calendario separan la salida de la llegada (el "+1"
 *  de un vuelo nocturno). Compara las fechas del reloj de cada
 *  aeropuerto, no instantes. */
export function diasDeDiferencia(salidaIso, llegadaIso) {
  if (!salidaIso || !llegadaIso) return 0
  const dia = (iso) => Math.floor(new Date(iso).getTime() / 86_400_000)
  return dia(llegadaIso) - dia(salidaIso)
}

/** 791 → "13 h 11 m" */
export function duracionTexto(min) {
  const total = Math.max(Number(min) || 0, 0)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} m`
  return `${h} h ${String(m).padStart(2, '0')} m`
}

/** "2026-11-20T11:45:00Z" → "vie 20 nov" */
export function fechaCorta(iso) {
  if (!iso) return ''
  return new Date(iso)
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(/\./g, '')
}

/** `[{ monto, moneda }]` → "US$ 373 + € 420": un viaje con vuelos de
 *  aerolíneas que cobran en monedas distintas no se puede sumar en un
 *  solo número sin inventar un tipo de cambio, así que se muestran los
 *  totales por moneda. */
export function formatearPrecios(precios) {
  return precios.map(formatearPrecio).join(' + ')
}

/** Suma de los precios de varios vuelos, agrupada por moneda. */
export function sumarPrecios(precios) {
  const porMoneda = new Map()
  for (const { monto, moneda } of precios) porMoneda.set(moneda, (porMoneda.get(moneda) ?? 0) + monto)
  return [...porMoneda.entries()].map(([moneda, monto]) => ({ monto, moneda }))
}
