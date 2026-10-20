import { sumarPrecios } from './formato.js'

/**
 * Tarifas por viaje — comparación de cabina/condiciones, al estilo de
 * cualquier motor de venta real (Duffel incluido). El backend no tiene
 * este concepto: un `Vuelo` del contrato trae un solo precio (§2). Las
 * tres tarifas de acá son una variación *derivada* de ese precio único,
 * enteramente del lado del front — igual espíritu que el precio por
 * ciudad de `servidor/hospedaje/datos.js`, pero para mostrar, no para
 * buscar.
 *
 * La tarifa es una condición de **todo el viaje**: se calcula sobre la
 * suma de sus vuelos (uno solo, o ida y vuelta, o varios tramos).
 *
 * Es sólo una vista: la reserva (`src/api/reservas.js`) descuenta los
 * asientos del vuelo, y no cobra ni emite nada.
 */
const NIVELES = [
  {
    id: 'basica',
    nombre: 'Económica Básica',
    multiplicador: 1,
    cambio: 'Con cargo (US$60)',
    reembolso: 'No reembolsable',
    equipaje: 'Equipaje de mano',
  },
  {
    id: 'flex',
    nombre: 'Económica Flex',
    multiplicador: 1.35,
    cambio: 'Con cargo (US$40)',
    reembolso: 'Reembolsable (US$80)',
    equipaje: 'Equipaje de mano + 1 valija',
  },
  {
    id: 'business',
    nombre: 'Business',
    multiplicador: 3.2,
    cambio: 'Sin cargo',
    reembolso: 'Reembolsable',
    equipaje: 'Equipaje de mano + 2 valijas',
  },
]

/** `vuelos`: los vuelos elegidos para el viaje (al menos uno).
 *  `precios`: total por moneda — casi siempre una sola. */
export function tarifasDe(vuelos) {
  const base = sumarPrecios(vuelos.map((v) => v.precio))
  return NIVELES.map((nivel) => ({
    ...nivel,
    precios: base.map(({ monto, moneda }) => ({ monto: Math.round(monto * nivel.multiplicador), moneda })),
  }))
}
