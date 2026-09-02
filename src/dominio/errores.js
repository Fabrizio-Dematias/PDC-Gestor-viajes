import { MOTIVO } from './estados.js'

/**
 * Un vertical no pudo responder. Es la *única* forma de fallo que el
 * front sabe interpretar: cualquier otra excepción que salga de la capa
 * api/ es un bug, no un fallo parcial, y debe verse como tal.
 */
export class ServicioNoDisponible extends Error {
  constructor(vertical, motivo = MOTIVO.ERROR, causa) {
    super(`Vertical "${vertical}" no disponible (${motivo})`)
    this.name = 'ServicioNoDisponible'
    this.vertical = vertical
    this.motivo = motivo
    this.causa = causa
  }
}

export function esNoDisponible(error) {
  return error instanceof ServicioNoDisponible
}
