import { buscarHospedaje } from '../api/hospedaje.js'
import { buscarTraslado } from '../api/traslado.js'
import { buscarVuelos } from '../api/vuelos.js'
import ListaHospedaje from '../components/resultados/ListaHospedaje.jsx'
import ListaTraslado from '../components/resultados/ListaTraslado.jsx'
import ListaVuelos from '../components/resultados/ListaVuelos.jsx'

/**
 * Registro de verticales. Es la única lista: la usan la página de
 * resultados, la encuesta de preferencias, el panel de admin, el panel
 * de fallos y las solapas del buscador.
 *
 * Sumar autos o cruceros es agregar un fetcher, un componente de lista y
 * una entrada acá. Nada de lo existente se toca — que es exactamente el
 * punto de haber armado el vertical como un patrón y no como dos
 * pantallas parecidas.
 *
 * `camposBusqueda` es lo que ese vertical necesita del criterio de
 * búsqueda para tener sentido — lo usa `Resultados.jsx` para decidir si
 * se lo llega a pedir siquiera (docs/contrato-agregador.md §4).
 * `usaVuelta`, `etiquetaIda` y `placeholderDestino` son lo que usa la
 * solapa de ese vertical en `BuscadorViajes.jsx` para no mostrar los
 * mismos campos con el mismo texto para los tres.
 */
export const VERTICALES = [
  {
    id: 'vuelos',
    titulo: 'Vuelos',
    icono: '✈',
    descripcionPreferencia: 'Pasajes aéreos de ida y vuelta',
    fetcher: buscarVuelos,
    Lista: ListaVuelos,
    camposBusqueda: ['origen', 'destino', 'ida'],
    usaVuelta: true,
    etiquetaIda: 'Ida',
    placeholderDestino: '¿A dónde vas?',
  },
  {
    id: 'hospedaje',
    titulo: 'Hospedaje',
    icono: '⌂',
    descripcionPreferencia: 'Hoteles, aparts y hostales en el destino',
    fetcher: buscarHospedaje,
    Lista: ListaHospedaje,
    camposBusqueda: ['destino', 'ida'],
    usaVuelta: true,
    etiquetaIda: 'Check-in',
    placeholderDestino: '¿Dónde te hospedás?',
  },
  {
    id: 'traslado',
    titulo: 'Traslado',
    icono: '🚐',
    descripcionPreferencia: 'Combi, auto privado o taxi del aeropuerto al destino',
    fetcher: buscarTraslado,
    Lista: ListaTraslado,
    camposBusqueda: ['destino', 'ida'],
    usaVuelta: false,
    etiquetaIda: 'Fecha de llegada',
    placeholderDestino: '¿A qué ciudad llegás?',
  },
]

export const IDS_VERTICALES = VERTICALES.map((v) => v.id)

export function verticalPorId(id) {
  return VERTICALES.find((v) => v.id === id)
}
