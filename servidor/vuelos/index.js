import { abrirBase } from '../comun/base.js'
import { CONFIG } from '../comun/config.js'
import { conEstado, crearServicio, ErrorHttp } from '../comun/http.js'
import { ciudades, resolverLugar } from '../comun/lugares.js'
import { crearSaludDemo } from '../comun/salud-demo.js'
import { crearEsquema, sembrar } from './datos.js'
import { crearProveedor } from './proveedor.js'
import { crearReservas } from './reservas.js'

const base = abrirBase(import.meta.url, 'vuelos.db')
crearEsquema(base)
const { insertados, total } = sembrar(base)
console.log(
  `[vuelos] base propia lista: ${total} itinerarios` +
    (insertados ? ` (${insertados} recién sembrados)` : ''),
)

const proveedor = crearProveedor(base)
const salud = crearSaludDemo('vuelos')
const reservas = crearReservas(base)
console.log(`[vuelos] proveedor: ${proveedor.nombre}`)

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Cuántas combinaciones origen×destino se consultan como máximo cuando
 *  el usuario elige ciudades con varios aeropuertos. Con la base propia
 *  sobra; con una API externa cada una es un pedido más. */
const MAX_PARES = 4
/** Tope de ítems en la respuesta: la lista tiene que poder leerse. */
const MAX_RESULTADOS = 40

function lugarDe(nombre, valor) {
  if (!valor) throw new ErrorHttp(400, `falta el parámetro ${nombre}`)
  const lugar = resolverLugar(valor, { tieneVuelos: proveedor.tieneVuelos })
  if (!lugar) {
    throw new ErrorHttp(400, { error: `${nombre} desconocido: ${valor}`, motivo: 'lugar_desconocido' })
  }
  return lugar
}

function validar({ origen, destino, ida, pasajeros }) {
  const desde = lugarDe('origen', origen)
  const hasta = lugarDe('destino', destino)
  if (!FECHA.test(ida ?? '')) throw new ErrorHttp(400, 'ida debe ser una fecha AAAA-MM-DD')
  const n = Number(pasajeros ?? 1)
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    throw new ErrorHttp(400, 'pasajeros debe ser un entero entre 1 y 9')
  }
  // Mismo aeropuerto en los dos extremos (por ejemplo Buenos Aires →
  // Ezeiza): no hay vuelo posible y no es culpa de ningún proveedor.
  if (desde.aeropuertos.some((a) => hasta.aeropuertos.includes(a))) {
    throw new ErrorHttp(400, { error: 'el origen y el destino son el mismo lugar', motivo: 'mismo_lugar' })
  }
  return { desde, hasta, ida, pasajeros: n }
}

/**
 * Busca en cada combinación de aeropuertos y junta todo. Un par que
 * falla no tira abajo a los otros —es la misma lógica de fallos
 * parciales de todo el sistema, un nivel más abajo—: sólo se rinde si
 * fallaron todos.
 */
async function buscarEnPares({ desde, hasta, ida, pasajeros }) {
  const origenes = proveedor.expandir(desde)
  const destinos = proveedor.expandir(hasta)
  const pares = origenes
    .flatMap((o) => destinos.map((d) => [o, d]))
    .filter(([o, d]) => o !== d)
    .slice(0, MAX_PARES)

  const resultados = await Promise.allSettled(
    pares.map(([origen, destino]) => proveedor.buscar({ origen, destino, ida, pasajeros })),
  )
  const fallidos = resultados.filter((r) => r.status === 'rejected')
  if (pares.length > 0 && fallidos.length === pares.length) throw fallidos[0].reason
  for (const f of fallidos) console.warn('[vuelos] un par falló, se sigue con los otros:', f.reason?.message ?? f.reason)

  return resultados.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
}

/** Sin repetidos, y por precio cuando todos están en la misma moneda
 *  (con monedas mezcladas —Duffel devuelve la de cada aerolínea— ordenar
 *  por monto compararía dólares con euros, así que se deja el orden de
 *  la fuente). */
function ordenar(items) {
  const vistos = new Set()
  const unicos = items.filter((v) => !vistos.has(v.id) && vistos.add(v.id))
  const unaMoneda = new Set(unicos.map((v) => v.precio.moneda)).size <= 1
  if (unaMoneda) unicos.sort((a, b) => a.precio.monto - b.precio.monto || a.duracion_min - b.duracion_min)
  return unicos.slice(0, MAX_RESULTADOS)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Valida el pedido de reserva. La `Idempotency-Key` es obligatoria: sin
 * ella un reintento tras un timeout no se podría distinguir de una
 * reserva nueva, y reservar dos veces el mismo asiento por un corte de
 * red es justo lo que esta clave evita (Módulo 3).
 */
function validarReserva(cuerpo, headers) {
  const clave = String(headers['idempotency-key'] ?? '').trim()
  if (!clave) {
    throw new ErrorHttp(400, { error: 'falta la cabecera Idempotency-Key', motivo: 'sin_idempotency_key' })
  }
  if (clave.length > 128) throw new ErrorHttp(400, 'la Idempotency-Key no puede pasar de 128 caracteres')

  const vuelos = Array.isArray(cuerpo?.vuelos) ? cuerpo.vuelos : cuerpo?.vuelo_id ? [cuerpo.vuelo_id] : []
  if (vuelos.length === 0 || vuelos.length > 6 || vuelos.some((v) => typeof v !== 'string' || !v.trim())) {
    throw new ErrorHttp(400, 'vuelos debe ser una lista de entre 1 y 6 ids de vuelo')
  }
  const pasajeros = Number(cuerpo?.pasajeros ?? 1)
  if (!Number.isInteger(pasajeros) || pasajeros < 1 || pasajeros > 9) {
    throw new ErrorHttp(400, 'pasajeros debe ser un entero entre 1 y 9')
  }
  const email = cuerpo?.contacto?.email
  if (email !== undefined && !EMAIL.test(String(email))) throw new ErrorHttp(400, 'el email de contacto no es válido')
  const nombres = Array.isArray(cuerpo?.nombres) ? cuerpo.nombres.map(String).slice(0, 9) : undefined

  return { reservaId: clave, vuelos, pasajeros, email, nombres, usuarioId: cuerpo?.usuario_id }
}

/**
 * Catálogo de ciudades para el buscador (v1). Es dato estático, así que
 * se arma una sola vez. Cada ciudad trae sus aeropuertos y si tienen
 * vuelos: con eso el front ofrece "Buenos Aires (todos los
 * aeropuertos)" además de Ezeiza y Aeroparque por separado, y no
 * propone aeropuertos sin servicio en la pestaña de vuelos.
 */
const CATALOGO = {
  version: 1,
  ciudades: ciudades().map((c) => ({
    codigo: c.codigo,
    nombre: c.nombre,
    pais: c.pais,
    trafico: c.rutas,
    vuelos: c.rutas > 0,
    aeropuertos: c.aeropuertos.map((a) => ({ iata: a.iata, nombre: a.nombre, vuelos: a.rutas > 0 })),
  })),
}

crearServicio({
  nombre: 'vuelos',
  puerto: CONFIG.vuelos.puerto,
  // Listo = la base abre y tiene datos. (Un proveedor externo caído no
  // cuenta: eso lo absorben el timeout y el breaker del agregador, y
  // sacar al servicio del reparto no lo arreglaría.)
  listo: () => {
    if (!salud.listo) throw new Error('no listo (simulado)')
    if (!base.prepare('SELECT 1 FROM itinerarios LIMIT 1').get()) throw new Error('la base no tiene itinerarios')
    return { proveedor: proveedor.nombre }
  },
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
     * Reservar (Módulo 3, canal síncrono): el agregador llama acá y
     * **espera** la respuesta, porque el usuario necesita saber en ese
     * momento si consiguió el asiento.
     *
     *   201  reserva creada
     *   200  la misma `Idempotency-Key` ya existía: se devuelve esa reserva
     *        (`repetida: true`), sin descontar otro asiento
     *   409  sin cupo (`motivo: sin_cupo`)
     *   404  el vuelo no existe o no se puede reservar acá
     *   400  falta la `Idempotency-Key` o el pedido es inválido
     */
    'POST /api/reservas': async ({ cuerpo, headers, req }) => {
      await salud.aplicar(req)
      const pedido = validarReserva(cuerpo, headers)
      const resultado = await reservas.reservar(pedido)
      if (resultado.sinCupo) {
        return conEstado(409, { error: 'no quedan asientos suficientes', motivo: 'sin_cupo', ...resultado.sinCupo })
      }
      return conEstado(resultado.creada ? 201 : 200, resultado.reserva)
    },

    'GET /api/reservas/:id': ({ params }) => {
      const reserva = reservas.leer(params.id)
      if (!reserva) throw new ErrorHttp(404, { error: `no existe la reserva ${params.id}`, motivo: 'reserva_desconocida' })
      return reserva
    },

    'GET /api/cupos/:vueloId': ({ params }) => {
      const cupo = reservas.cupo(params.vueloId)
      if (!cupo) throw new ErrorHttp(404, { error: `el vuelo ${params.vueloId} todavía no tiene cupo`, motivo: 'vuelo_desconocido' })
      return cupo
    },

    // --- Demostración de concurrencia (no forma parte del sistema): el
    // defecto a propósito y un vuelo con una capacidad exacta. ---
    'GET /demo/concurrencia': () => ({ modo: reservas.modo }),
    'PUT /demo/concurrencia': ({ cuerpo }) => ({ modo: reservas.fijarModo(cuerpo?.modo) }),
    'PUT /demo/cupos/:vueloId': ({ params, cuerpo }) => reservas.fijarCupo(params.vueloId, cuerpo?.capacidad),

    /** Catálogo de ciudades y aeropuertos (v1) — el que usa el buscador. */
    'GET /api/ciudades': () => ({ ...CATALOGO, generado_en: new Date().toISOString() }),

    /**
     * Catálogo de lugares **anterior** (v0): aeropuertos sueltos y, para
     * cada origen, los destinos con vuelo directo. Se conserva para quien
     * todavía lo consuma, pero el buscador ya no lo usa: ofrecer sólo los
     * destinos con vuelo directo escondía viajes posibles (cualquier cosa
     * que requiriera una escala) y hacía que Aeroparque no pudiera ir a
     * Madrid.
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
      const criterios = validar(query)

      try {
        return {
          vertical: 'vuelos',
          estado: 'ok',
          generado_en: new Date().toISOString(),
          items: ordenar(await buscarEnPares(criterios)),
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
