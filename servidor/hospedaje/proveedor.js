import { CONFIG } from '../comun/config.js'
import { crearProveedorAmadeus } from './proveedor-amadeus.js'
import { crearProveedorFicticio } from './proveedor-ficticio.js'

/**
 * # ProveedorDeHospedaje — la interfaz
 *
 * ```
 * nombre: string
 * buscar({ destino, ida, vuelta, noches, pasajeros }) → Promise<Alojamiento[]>
 * ```
 *
 * `Alojamiento` es la forma de `hospedaje[]` del contrato
 * (docs/contrato-agregador.md §2).
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
