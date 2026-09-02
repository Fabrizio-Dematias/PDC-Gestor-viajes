/**
 * Implementación de `ProveedorDeVuelos` contra la base propia.
 *
 * Es la que se usa por defecto: no depende de internet ni de la cuota de
 * Amadeus, así que la demostración funciona siempre. Ver el contrato de
 * la interfaz en proveedor.js.
 */
export function crearProveedorFicticio(base) {
  const consulta = base.prepare(`
    SELECT * FROM itinerarios
    WHERE origen = ? AND destino = ?
    ORDER BY precio_base
  `)

  return {
    nombre: 'ficticio',

    async buscar({ origen, destino, ida, pasajeros }) {
      const filas = consulta.all(origen, destino)

      return filas.map((f) => {
        const salida = new Date(`${ida}T${f.hora_salida}:00Z`)
        const llegada = new Date(salida.getTime() + f.duracion_min * 60_000)
        return {
          id: `${f.id}-${ida}`,
          aerolinea: f.aerolinea,
          codigo_aerolinea: f.codigo_aerolinea,
          origen: f.origen,
          destino: f.destino,
          salida: salida.toISOString(),
          llegada: llegada.toISOString(),
          duracion_min: f.duracion_min,
          escalas: f.escalas,
          precio: { monto: f.precio_base * pasajeros, moneda: f.moneda },
        }
      })
    },
  }
}
