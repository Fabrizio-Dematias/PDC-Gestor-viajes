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
