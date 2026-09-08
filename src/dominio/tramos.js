/**
 * Multidestino: una búsqueda con más de un tramo (vuelos, traslado).
 * Los criterios viajan como `URLSearchParams` (pares planos), así que
 * la lista de tramos se aplana con un índice en el nombre del campo —
 * `origen_0`, `destino_0`, `fecha_0`, `origen_1`, ... — y `tramos` con
 * la cantidad. `BuscadorViajes.jsx` arma esto al buscar,
 * `Resultados.jsx` lo vuelve a leer para pedir cada tramo por separado.
 */

export function tramoVacio() {
  return { origen: '', destino: '', fecha: '' }
}

/** `tramos: [...]` → campos planos para `URLSearchParams`. */
export function codificarTramos(tramos) {
  const plano = { tramos: String(tramos.length) }
  tramos.forEach((t, i) => {
    plano[`origen_${i}`] = t.origen ?? ''
    plano[`destino_${i}`] = t.destino ?? ''
    plano[`fecha_${i}`] = t.fecha ?? ''
  })
  return plano
}

/** Campos planos → `tramos: [...]`, o `null` si esta búsqueda no era
 *  multidestino (no vale la pena distinguir "sin tramos" de "tramos
 *  vacíos": para quien lee el resultado es la misma situación). */
export function decodificarTramos(criterios) {
  const cantidad = Number(criterios.tramos)
  if (!cantidad || cantidad < 1) return null
  return Array.from({ length: cantidad }, (_, i) => ({
    origen: criterios[`origen_${i}`] ?? '',
    destino: criterios[`destino_${i}`] ?? '',
    fecha: criterios[`fecha_${i}`] ?? '',
  }))
}

export function tramosCompletos(tramos, requiereOrigen) {
  return tramos.every((t) => t.destino && t.fecha && (!requiereOrigen || t.origen))
}
