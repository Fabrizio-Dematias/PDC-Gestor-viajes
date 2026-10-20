/** Fecha de hoy (calendario del usuario, no UTC) como `AAAA-MM-DD`. */
export function hoy() {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/** `AAAA-MM-DD` + `n` días. Vacío si la fecha viene vacía o rota. */
export function sumarDias(fecha, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '')) return ''
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function enDias(n) {
  return sumarDias(hoy(), n)
}

/** Búsqueda con la que arranca el formulario de la portada. `BUE` es
 *  Buenos Aires entera (Ezeiza y Aeroparque): la que más gente quiere
 *  decir cuando dice "Buenos Aires". */
export const CRITERIOS_INICIALES = {
  origen: 'BUE',
  destino: 'MAD',
  ida: enDias(30),
  vuelta: enDias(40),
  pasajeros: '1',
}
