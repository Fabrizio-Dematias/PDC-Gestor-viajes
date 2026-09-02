import { CONFIG } from '../comun/config.js'
import { crearProveedorAmadeus } from './proveedor-amadeus.js'
import { crearProveedorFicticio } from './proveedor-ficticio.js'

/**
 * # ProveedorDeVuelos — la interfaz
 *
 * JavaScript no tiene interfaces, así que el contrato se documenta y se
 * respeta. Es el mismo compromiso que en cualquier lenguaje con
 * `interface`: lo que sostiene el diseño es que el resto del servicio
 * programe contra esta forma y no contra una implementación concreta.
 *
 * ```
 * nombre: string
 * buscar({ origen, destino, ida, vuelta, pasajeros }) → Promise<Vuelo[]>
 * ```
 *
 * `Vuelo` es exactamente la forma de `vuelos[]` del contrato del
 * agregador (docs/contrato-agregador.md §2). Quien implemente esta
 * interfaz se hace cargo de traducir su fuente a ese formato.
 *
 * Reglas para cualquier implementación:
 * - devolver `[]` si no hay resultados, nunca `null`;
 * - lanzar si la fuente falla, nunca devolver a medias — quien decide
 *   qué hacer con un fallo es el servicio, no el proveedor.
 *
 * Dos implementaciones intercambiables por configuración:
 * `PROVEEDOR=ficticio` (base propia) o `PROVEEDOR=amadeus` (API real).
 */
export function crearProveedor(base) {
  if (CONFIG.proveedor === 'amadeus') return crearProveedorAmadeus()
  return crearProveedorFicticio(base)
}
