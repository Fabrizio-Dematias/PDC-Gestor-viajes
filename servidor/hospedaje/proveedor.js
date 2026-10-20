import { CONFIG } from '../comun/config.js'
import { crearProveedorAmadeus } from './proveedor-amadeus.js'
import { crearProveedorFicticio } from './proveedor-ficticio.js'

/**
 * # ProveedorDeHospedaje — la interfaz
 *
 * ```
 * nombre: string
 * buscar({ destino, lugar, ida, vuelta, noches, pasajeros }) → Promise<Alojamiento[]>
 * ```
 *
 * `Alojamiento` es la forma de `hospedaje[]` del contrato
 * (docs/contrato-agregador.md §2).
 *
 * `destino` es el código de la ciudad (`BUE`, no `EZE`: se aloja en la
 * ciudad, no en el aeropuerto) y `lugar` el mismo lugar ya resuelto con
 * su nombre, país y aeropuerto principal (servidor/comun/lugares.js).
 *
 * Es deliberadamente **distinta** de `ProveedorDeVuelos`: vuelos y
 * hospedaje son dominios distintos y unificarlos a la fuerza sólo
 * agregaría una capa de traducción que nadie necesita. Lo que comparten
 * es la disciplina, no la firma.
 */
export function crearProveedor(base) {
  if (CONFIG.proveedor === 'amadeus') return crearProveedorAmadeus()
  return crearProveedorFicticio(base)
}
