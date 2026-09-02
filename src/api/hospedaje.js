import { buscarVertical } from './cliente.js'

export function buscarHospedaje(criterios, opciones) {
  return buscarVertical('hospedaje', criterios, opciones)
}
