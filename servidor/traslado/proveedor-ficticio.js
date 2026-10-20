/** Implementación de `ProveedorDeTraslado` contra la base propia. */
export function crearProveedorFicticio(base) {
  const consultaCiudad = base.prepare('SELECT * FROM ciudades WHERE destino_iata = ?')
  const consultaOpciones = base.prepare('SELECT * FROM opciones ORDER BY precio_base ASC')

  return {
    nombre: 'ficticio',

    async buscar({ lugar, pasajeros }) {
      // Las tarifas se cargaron por aeropuerto; la ciudad usa las de su
      // aeropuerto principal.
      const ciudad = consultaCiudad.get(lugar.principal)
      if (!ciudad) return [] // destino sin traslados cargados

      return consultaOpciones
        .all()
        .filter((o) => o.capacidad >= pasajeros)
        .map((o) => ({
          id: `${o.id}-${lugar.codigo.toLowerCase()}`,
          proveedor: o.proveedor,
          vehiculo: o.vehiculo,
          capacidad: o.capacidad,
          precio: {
            monto: Math.round((o.precio_base * ciudad.indice) / 500) * 500,
            moneda: o.moneda,
          },
        }))
    },
  }
}
