/**
 * Tarifas por vuelo — comparación de cabina/condiciones, al estilo de
 * cualquier motor de venta real (Duffel incluido). El backend no tiene
 * este concepto: un `Vuelo` del contrato trae un solo precio (§2). Las
 * tres tarifas de acá son una variación *derivada* de ese precio único,
 * enteramente del lado del front — igual espíritu que el precio por
 * ciudad de `servidor/hospedaje/datos.js`, pero para mostrar, no para
 * buscar.
 *
 * No hay reserva real detrás (Etapa 7, opcional, sigue sin encarar):
 * esto sólo demuestra la pantalla de comparación de tarifas y el
 * checkout, no cobra ni emite nada.
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

export function tarifasDe(vuelo) {
  return NIVELES.map((nivel) => ({
    ...nivel,
    precio: {
      monto: Math.round(vuelo.precio.monto * nivel.multiplicador),
      moneda: vuelo.precio.moneda,
    },
  }))
}
