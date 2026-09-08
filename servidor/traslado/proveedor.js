import { crearProveedorFicticio } from './proveedor-ficticio.js'

/**
 * # ProveedorDeTraslado — la interfaz
 *
 * Mismo contrato que `ProveedorDeVuelos`/`ProveedorDeHospedaje`
 * (servidor/vuelos/proveedor.js): el resto del servicio programa contra
 * esta forma, no contra una implementación concreta.
 *
 * ```
 * nombre: string
 * buscar({ destino, pasajeros }) → Promise<Traslado[]>
 * ```
 *
 * `Traslado` es exactamente la forma de `traslado[]` del contrato del
 * agregador (docs/contrato-agregador.md §2).
 *
 * Hoy sólo existe la implementación ficticia: no hay una API pública de
 * tarifas de traslado terrestre. Sumar una real el día que aparezca es
 * un archivo nuevo (`proveedor-<nombre>.js`) y una línea acá, igual que
 * se hizo con `proveedor-amadeus.js` para vuelos y hospedaje.
 */
export function crearProveedor(base) {
  return crearProveedorFicticio(base)
}
