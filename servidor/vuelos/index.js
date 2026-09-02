import { abrirBase } from '../comun/base.js'
import { CONFIG } from '../comun/config.js'
import { crearServicio, ErrorHttp } from '../comun/http.js'
import { crearSaludDemo } from '../comun/salud-demo.js'
import { crearEsquema, sembrar } from './datos.js'
import { crearProveedor } from './proveedor.js'

const base = abrirBase(import.meta.url, 'vuelos.db')
crearEsquema(base)
const { insertados, total } = sembrar(base)
console.log(
  `[vuelos] base propia lista: ${total} itinerarios` +
    (insertados ? ` (${insertados} recién sembrados)` : ''),
)

const proveedor = crearProveedor(base)
const salud = crearSaludDemo('vuelos')
console.log(`[vuelos] proveedor: ${proveedor.nombre}`)

const FECHA = /^\d{4}-\d{2}-\d{2}$/

function validar({ origen, destino, ida, pasajeros }) {
  if (!origen) throw new ErrorHttp(400, 'falta el parámetro origen')
  if (!destino) throw new ErrorHttp(400, 'falta el parámetro destino')
  if (!FECHA.test(ida ?? '')) throw new ErrorHttp(400, 'ida debe ser una fecha AAAA-MM-DD')
  const n = Number(pasajeros ?? 1)
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    throw new ErrorHttp(400, 'pasajeros debe ser un entero entre 1 y 9')
  }
  return { origen, destino, ida, pasajeros: n }
}

crearServicio({
  nombre: 'vuelos',
  puerto: CONFIG.vuelos.puerto,
  rutas: {
    ...salud.rutas,

    'GET /salud': () => ({
      servicio: 'vuelos',
      proveedor: proveedor.nombre,
      salud_simulada: salud.estado,
      itinerarios: base.prepare('SELECT COUNT(*) AS n FROM itinerarios').get().n,
      aeropuertos: base.prepare('SELECT COUNT(*) AS n FROM aeropuertos').get().n,
    }),

    /**
     * Catálogo de lugares: qué aeropuertos hay y, para cada origen, a
     * qué destinos se puede volar de verdad.
     *
     * Sin esto el front tendría que ofrecer combinaciones que no
     * existen —de las 36 × 70 posibles, sólo 255 son rutas reales— y la
     * mayoría de las búsquedas devolvería vacío.
     */
    'GET /api/lugares': () => {
      const aeropuertos = base
        .prepare('SELECT iata, nombre, ciudad, pais FROM aeropuertos ORDER BY ciudad')
        .all()
      const nombreDe = new Map(aeropuertos.map((a) => [a.iata, a.ciudad]))

      const rutas = {}
      for (const { origen, destino } of base
        .prepare('SELECT DISTINCT origen, destino FROM itinerarios')
        .all()) {
        ;(rutas[origen] ??= []).push(destino)
      }
      for (const destinos of Object.values(rutas)) {
        destinos.sort((a, b) => (nombreDe.get(a) ?? a).localeCompare(nombreDe.get(b) ?? b))
      }

      return { aeropuertos, origenes: Object.keys(rutas).sort(), rutas }
    },

    'GET /api/vuelos': async ({ query, req }) => {
      await salud.aplicar(req)
      const criterios = { ...validar(query), vuelta: query.vuelta }

      try {
        return {
          vertical: 'vuelos',
          estado: 'ok',
          generado_en: new Date().toISOString(),
          items: await proveedor.buscar(criterios),
        }
      } catch (error) {
        // La fuente falló. Para el usuario esto es "no disponible", que
        // es distinto de un error del servicio: el contrato pide 503 con
        // cuerpo JSON válido, nunca un 500 pelado.
        console.error('[vuelos] el proveedor falló:', error?.message ?? error)
        throw new ErrorHttp(503, {
          vertical: 'vuelos',
          estado: 'unavailable',
          motivo: error?.motivo === 'timeout' ? 'timeout' : 'error',
          detalle: error?.detalle ?? error?.message,
          generado_en: new Date().toISOString(),
        })
      }
    },
  },
})
