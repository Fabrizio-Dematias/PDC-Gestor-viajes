import { buscarVertical } from './cliente.js'

export function buscarVuelos(criterios, opciones) {
  return buscarVertical('vuelos', criterios, opciones)
}
