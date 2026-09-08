import { abrirBase } from '../comun/base.js'
import { CONFIG } from '../comun/config.js'
import { crearServicio, ErrorHttp } from '../comun/http.js'
import { crearSaludDemo } from '../comun/salud-demo.js'
import { crearEsquema, sembrar } from './datos.js'
import { crearProveedor } from './proveedor.js'

const base = abrirBase(import.meta.url, 'traslado.db')
crearEsquema(base)
const { total } = sembrar(base)
console.log(`[traslado] base propia lista: ${total} ciudades con tarifa cargada`)

const proveedor = crearProveedor(base)
const salud = crearSaludDemo('traslado')
console.log(`[traslado] proveedor: ${proveedor.nombre}`)

/** `origen` y `vuelta` no aplican a este vertical (un traslado es
 *  aeropuerto→ciudad de destino, de ida): se ignoran si vienen — mismo
 *  criterio que `origen` en hospedaje (docs/contrato-agregador.md §1,
 *  nota 1). */
function validar({ destino, pasajeros }) {
  if (!destino) throw new ErrorHttp(400, 'falta el parámetro destino')
  const n = Number(pasajeros ?? 1)
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    throw new ErrorHttp(400, 'pasajeros debe ser un entero entre 1 y 9')
  }
  return { destino, pasajeros: n }
}

crearServicio({
  nombre: 'traslado',
  puerto: CONFIG.traslado.puerto,
  rutas: {
    ...salud.rutas,

    'GET /salud': () => ({
      servicio: 'traslado',
      proveedor: proveedor.nombre,
      salud_simulada: salud.estado,
      ciudades: base.prepare('SELECT COUNT(*) AS n FROM ciudades').get().n,
    }),

    'GET /api/traslado': async ({ query, req }) => {
      await salud.aplicar(req)
      const criterios = validar(query)

      try {
        return {
          vertical: 'traslado',
          estado: 'ok',
          generado_en: new Date().toISOString(),
          items: await proveedor.buscar(criterios),
        }
      } catch (error) {
        console.error('[traslado] el proveedor falló:', error?.message ?? error)
        throw new ErrorHttp(503, {
          vertical: 'traslado',
          estado: 'unavailable',
          motivo: error?.motivo === 'timeout' ? 'timeout' : 'error',
          detalle: error?.detalle ?? error?.message,
          generado_en: new Date().toISOString(),
        })
      }
    },
  },
})
