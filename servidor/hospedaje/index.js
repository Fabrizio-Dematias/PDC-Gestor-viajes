import { abrirBase } from '../comun/base.js'
import { CONFIG } from '../comun/config.js'
import { crearServicio, ErrorHttp } from '../comun/http.js'
import { crearSaludDemo } from '../comun/salud-demo.js'
import { crearEsquema, sembrar } from './datos.js'
import { crearProveedor } from './proveedor.js'

const base = abrirBase(import.meta.url, 'hospedaje.db')
crearEsquema(base)
const { insertados, total } = sembrar(base)
console.log(
  `[hospedaje] base propia lista: ${total} alojamientos` +
    (insertados ? ` (${insertados} recién sembrados)` : ''),
)

const proveedor = crearProveedor(base)
const salud = crearSaludDemo('hospedaje')
console.log(`[hospedaje] proveedor: ${proveedor.nombre}`)

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const NOCHES_POR_DEFECTO = 3

function validar({ destino, ida, vuelta, pasajeros }) {
  if (!destino) throw new ErrorHttp(400, 'falta el parámetro destino')
  if (!FECHA.test(ida ?? '')) throw new ErrorHttp(400, 'ida debe ser una fecha AAAA-MM-DD')
  if (vuelta && !FECHA.test(vuelta)) throw new ErrorHttp(400, 'vuelta debe ser AAAA-MM-DD')

  const n = Number(pasajeros ?? 1)
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    throw new ErrorHttp(400, 'pasajeros debe ser un entero entre 1 y 9')
  }

  const dias = vuelta ? Math.round((new Date(vuelta) - new Date(ida)) / 86_400_000) : 0
  if (vuelta && dias <= 0) throw new ErrorHttp(400, 'vuelta debe ser posterior a ida')

  return { destino, ida, vuelta, pasajeros: n, noches: dias > 0 ? dias : NOCHES_POR_DEFECTO }
}

crearServicio({
  nombre: 'hospedaje',
  puerto: CONFIG.hospedaje.puerto,
  rutas: {
    ...salud.rutas,

    'GET /salud': () => ({
      servicio: 'hospedaje',
      proveedor: proveedor.nombre,
      salud_simulada: salud.estado,
      alojamientos: base.prepare('SELECT COUNT(*) AS n FROM alojamientos').get().n,
    }),

    'GET /api/hospedaje': async ({ query, req }) => {
      await salud.aplicar(req)
      const criterios = validar(query)

      try {
        return {
          vertical: 'hospedaje',
          estado: 'ok',
          generado_en: new Date().toISOString(),
          items: await proveedor.buscar(criterios),
        }
      } catch (error) {
        console.error('[hospedaje] el proveedor falló:', error?.message ?? error)
        throw new ErrorHttp(503, {
          vertical: 'hospedaje',
          estado: 'unavailable',
          motivo: error?.motivo === 'timeout' ? 'timeout' : 'error',
          detalle: error?.detalle ?? error?.message,
          generado_en: new Date().toISOString(),
        })
      }
    },
  },
})
