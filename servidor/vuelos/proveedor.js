import { CONFIG } from '../comun/config.js'
import { tieneVuelosEnDataset } from '../comun/lugares.js'
import { crearProveedorAmadeus } from './proveedor-amadeus.js'
import { crearProveedorDuffel } from './proveedor-duffel.js'
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
 * expandir(lugar) → string[]          (opcional)
 * tieneVuelos(iata) → boolean         (opcional)
 * ```
 *
 * `buscar` recibe **un** par de códigos (aeropuerto o ciudad). Qué
 * códigos se prueban cuando el usuario elige una ciudad con varios
 * aeropuertos lo decide `expandir`: la base propia busca en todos los
 * de la ciudad, Duffel pide el código de ciudad entero (`BUE`) porque
 * entiende de áreas metropolitanas. Si el proveedor no la define se usan
 * los aeropuertos de la ciudad con vuelos.
 *
 * `Vuelo` es exactamente la forma de `vuelos[]` del contrato del
 * agregador (docs/contrato-agregador.md §2). Quien implemente esta
 * interfaz se hace cargo de traducir su fuente a ese formato — incluido
 * `segmentos`, que sólo está cuando el itinerario tiene escalas.
 *
 * Reglas para cualquier implementación:
 * - devolver `[]` si no hay resultados, nunca `null`;
 * - lanzar si la fuente falla, nunca devolver a medias — quien decide
 *   qué hacer con un fallo es el servicio, no el proveedor;
 * - las horas son reloj local del aeropuerto, escritas con `Z`.
 *
 * Tres implementaciones intercambiables por configuración:
 * `PROVEEDOR=ficticio` (base propia), `amadeus` o `duffel` (APIs
 * reales — docs/proveedor-externo.md).
 */
export function crearProveedor(base) {
  const proveedor =
    CONFIG.proveedor === 'amadeus'
      ? crearProveedorAmadeus()
      : CONFIG.proveedor === 'duffel'
        ? crearProveedorDuffel()
        : crearProveedorFicticio(base)

  return {
    ...proveedor,
    expandir: proveedor.expandir ?? ((lugar) => lugar.aeropuertos),
    tieneVuelos: proveedor.tieneVuelos ?? tieneVuelosEnDataset,
  }
}
