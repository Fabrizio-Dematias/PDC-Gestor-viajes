/**
 * Implementación de `ProveedorDeHospedaje` contra la base propia.
 *
 * Los alojamientos se sembraron por aeropuerto, pero se buscan por
 * *ciudad*: una ciudad con varios aeropuertos (Madrid tiene tres en el
 * dataset) mostraría tres veces los mismos hoteles. Se usa el
 * aeropuerto principal de la ciudad, que es el que tiene el catálogo
 * completo, y los demás no suman alojamientos repetidos.
 */
export function crearProveedorFicticio(base) {
  const consulta = base.prepare(`
    SELECT * FROM alojamientos
    WHERE ciudad_iata = ?
    ORDER BY puntaje DESC
  `)

  /** Los nombres se sembraron con el nombre de ciudad de ese momento
   *  ("Gran Hotel Plaza Rome"); si el catálogo la corrigió desde
   *  entonces ("Roma") el hotel se renombra al leerlo, en vez de
   *  resembrar 48 mil filas. */
  const nombreActual = (a, ciudad) =>
    a.nombre.endsWith(a.ciudad) ? `${a.nombre.slice(0, -a.ciudad.length)}${ciudad}` : a.nombre

  return {
    nombre: 'ficticio',

    async buscar({ lugar, noches, pasajeros }) {
      return consulta.all(lugar.principal).map((a) => ({
        id: a.id,
        nombre: nombreActual(a, lugar.ciudad.nombre),
        ciudad: lugar.ciudad.nombre,
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
