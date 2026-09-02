/** Implementación de `ProveedorDeHospedaje` contra la base propia. */
export function crearProveedorFicticio(base) {
  const consulta = base.prepare(`
    SELECT * FROM alojamientos
    WHERE ciudad_iata = ?
    ORDER BY puntaje DESC
  `)

  return {
    nombre: 'ficticio',

    async buscar({ destino, noches, pasajeros }) {
      return consulta.all(destino).map((a) => ({
        id: a.id,
        nombre: a.nombre,
        ciudad: a.ciudad,
        estrellas: a.estrellas,
        puntaje: a.puntaje,
        opiniones: a.opiniones,
        servicios: JSON.parse(a.servicios),
        noches,
        precio: {
          monto: (a.precio_noche + (pasajeros - 1) * 12_000) * noches,
          moneda: a.moneda,
        },
      }))
    },
  }
}
