function enDias(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Búsqueda con la que arranca el formulario de la portada. */
export const CRITERIOS_INICIALES = {
  origen: 'EZE',
  destino: 'MAD',
  ida: enDias(30),
  vuelta: enDias(40),
  pasajeros: '1',
}
