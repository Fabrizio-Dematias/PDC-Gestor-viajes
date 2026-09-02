import { buscarHospedaje } from '../api/hospedaje.js'
import { buscarVuelos } from '../api/vuelos.js'
import ListaHospedaje from '../components/resultados/ListaHospedaje.jsx'
import ListaVuelos from '../components/resultados/ListaVuelos.jsx'

/**
 * Registro de verticales. Es la única lista: la usan la página de
 * resultados, la encuesta de preferencias, el panel de admin y el panel
 * de fallos.
 *
 * Sumar autos o cruceros es agregar un fetcher, un componente de lista y
 * una entrada acá. Nada de lo existente se toca — que es exactamente el
 * punto de haber armado el vertical como un patrón y no como dos
 * pantallas parecidas.
 */
export const VERTICALES = [
  {
    id: 'vuelos',
    titulo: 'Vuelos',
    icono: '✈',
    descripcionPreferencia: 'Pasajes aéreos de ida y vuelta',
    fetcher: buscarVuelos,
    Lista: ListaVuelos,
  },
  {
    id: 'hospedaje',
    titulo: 'Hospedaje',
    icono: '⌂',
    descripcionPreferencia: 'Hoteles, aparts y hostales en el destino',
    fetcher: buscarHospedaje,
    Lista: ListaHospedaje,
  },
]

export const IDS_VERTICALES = VERTICALES.map((v) => v.id)

export function verticalPorId(id) {
  return VERTICALES.find((v) => v.id === id)
}
