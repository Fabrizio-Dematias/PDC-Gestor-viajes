import { CONFIG, VERTICALES } from '../comun/config.js'
import { conEstado, crearServicio, ErrorHttp } from '../comun/http.js'
import { LlamadaFallida, pedirJson } from '../comun/pedir.js'

/**
 * El agregador.
 *
 * No calcula nada propio: decide a quién llamar, los llama a todos a la
 * vez, y arma una respuesta con lo que haya llegado dentro del
 * presupuesto de tiempo. Todo el valor está en qué hace cuando algo no
 * llega.
 *
 * También hace de puerta de entrada única para el front (perfil y
 * administración se proxean hacia el servicio de usuarios). Es una
 * decisión de comodidad, no de arquitectura: el front habla con un solo
 * origen y no hay que resolver CORS ni descubrimiento de servicios en el
 * navegador.
 */

const USUARIO_POR_DEFECTO = 'u-001'
/** Presupuesto para leer preferencias. Más corto que el de un vertical:
 *  es una consulta a una base local, y si tarda más algo anda mal. */
const TIMEOUT_CONTEXTO = 1200

const urlDe = (vertical) => CONFIG[vertical].url

/**
 * Preferencias del usuario + configuración del administrador.
 *
 * Si el servicio de usuarios no responde, **se falla abierto**: se
 * asume que todo está habilitado. Es la decisión menos mala. Fallar
 * cerrado dejaría al usuario sin ninguna sección por una caída que no
 * tiene nada que ver con vuelos ni con hospedaje — convertiría el fallo
 * de un servicio secundario en una caída total, que es exactamente lo
 * que este sistema existe para evitar.
 */
async function contexto(usuarioId) {
  try {
    const [config, perfil] = await Promise.all([
      pedirJson(`${CONFIG.usuarios.url}/api/admin/config`, { timeoutMs: TIMEOUT_CONTEXTO }),
      pedirJson(`${CONFIG.usuarios.url}/api/perfil`, {
        timeoutMs: TIMEOUT_CONTEXTO,
        headers: { 'x-usuario-id': usuarioId },
      }),
    ])
    return {
      config: config.datos ?? {},
      preferencias: perfil.datos?.preferencias ?? {},
      degradado: false,
    }
  } catch (error) {
    console.warn(
      `[agregador] usuarios no responde (${error?.motivo ?? 'error'}): se busca en todos los verticales`,
    )
    return { config: {}, preferencias: {}, degradado: true }
  }
}

/** ¿Hay que llamar a este vertical? Lo que no se llama no puede fallar. */
function decidir(vertical, ctx) {
  if (ctx.config[vertical]?.estado === 'inactivo') {
    return { llamar: false, motivo: 'apagado_por_admin' }
  }
  if (ctx.preferencias[vertical] === false) {
    return { llamar: false, motivo: 'desactivado_por_usuario' }
  }
  return { llamar: true }
}

/** Nunca lanza: un vertical que falla es un resultado, no una excepción. */
async function consultar(vertical, query) {
  const url = `${urlDe(vertical)}/api/${vertical}?${new URLSearchParams(query)}`
  try {
    const { ok, datos } = await pedirJson(url, { timeoutMs: CONFIG.timeouts.vertical })
    if (!ok) return { estado: 'unavailable', motivo: datos?.motivo ?? 'error' }
    if (!Array.isArray(datos?.items)) {
      console.error(`[agregador] ${vertical} respondió 200 sin items: rompe el contrato`)
      return { estado: 'unavailable', motivo: 'error' }
    }
    return { estado: 'ok', items: datos.items }
  } catch (error) {
    const motivo = error instanceof LlamadaFallida ? error.motivo : 'error'
    console.warn(`[agregador] ${vertical} → ${motivo}`)
    return { estado: 'unavailable', motivo }
  }
}

async function resolver(vertical, query, ctx) {
  const decision = decidir(vertical, ctx)
  if (!decision.llamar) return { estado: 'unavailable', motivo: decision.motivo }
  return consultar(vertical, query)
}

function criterios(query) {
  const { origen, destino, ida, vuelta, pasajeros } = query
  if (!destino) throw new ErrorHttp(400, 'falta el parámetro destino')
  if (!ida) throw new ErrorHttp(400, 'falta el parámetro ida')
  return Object.fromEntries(
    Object.entries({ origen, destino, ida, vuelta, pasajeros }).filter(([, v]) => v),
  )
}

/** Reenvía una llamada al servicio de usuarios tal cual vino. */
async function proxyUsuarios(ruta, { metodo = 'GET', cuerpo, headers } = {}) {
  try {
    const { ok, estado, datos } = await pedirJson(`${CONFIG.usuarios.url}${ruta}`, {
      metodo,
      cuerpo,
      timeoutMs: TIMEOUT_CONTEXTO,
      headers: { 'x-usuario-id': headers?.['x-usuario-id'] ?? USUARIO_POR_DEFECTO },
    })
    return ok ? datos : conEstado(estado, datos)
  } catch (error) {
    throw new ErrorHttp(503, {
      error: 'el servicio de usuarios no está disponible',
      motivo: error?.motivo ?? 'error',
    })
  }
}

crearServicio({
  nombre: 'agregador',
  puerto: CONFIG.agregador.puerto,
  rutas: {
    /** Estado de todo el sistema, de un vistazo. */
    'GET /salud': async () => {
      const servicios = await Promise.all(
        ['vuelos', 'hospedaje', 'usuarios'].map(async (s) => {
          try {
            const { ok, datos } = await pedirJson(`${CONFIG[s].url}/salud`, { timeoutMs: 1000 })
            return [s, ok ? { estado: 'ok', ...datos } : { estado: 'unavailable' }]
          } catch (error) {
            return [s, { estado: 'unavailable', motivo: error?.motivo ?? 'error' }]
          }
        }),
      )
      return {
        servicio: 'agregador',
        generado_en: new Date().toISOString(),
        servicios: Object.fromEntries(servicios),
      }
    },

    /**
     * Búsqueda de un vertical. Es la que usa el front: una request por
     * sección, para que cada una pinte apenas tiene su respuesta en vez
     * de esperar a la más lenta. Ver contrato §4.
     */
    'GET /api/buscar/:vertical': async ({ params, query, headers }) => {
      const { vertical } = params
      if (!VERTICALES.includes(vertical)) throw new ErrorHttp(404, `vertical desconocido: ${vertical}`)

      const ctx = await contexto(headers['x-usuario-id'] ?? USUARIO_POR_DEFECTO)
      const salida = await resolver(vertical, criterios(query), ctx)
      const generado_en = new Date().toISOString()

      if (salida.estado === 'ok') {
        return { vertical, estado: 'ok', generado_en, items: salida.items }
      }
      return conEstado(503, { vertical, estado: 'unavailable', motivo: salida.motivo, generado_en })
    },

    /**
     * Búsqueda combinada. El front no la usa, pero es la forma canónica
     * del agregador y sirve para mostrarlo desde curl en la defensa.
     *
     * Siempre responde 200, aunque hayan fallado todos los verticales:
     * el fallo parcial no es un error de la request, es el resultado.
     */
    'GET /api/buscar': async ({ query, headers }) => {
      const criterio = criterios(query)
      const ctx = await contexto(headers['x-usuario-id'] ?? USUARIO_POR_DEFECTO)

      // En paralelo, no en serie: el total es el del vertical más lento,
      // no la suma de todos.
      const resultados = await Promise.all(
        VERTICALES.map(async (v) => [v, await resolver(v, criterio, ctx)]),
      )

      const respuesta = { generado_en: new Date().toISOString(), no_disponibles: [] }
      for (const [vertical, salida] of resultados) {
        respuesta[vertical] = salida.estado === 'ok' ? salida.items : []
        if (salida.estado !== 'ok') {
          respuesta.no_disponibles.push({ vertical, motivo: salida.motivo })
        }
      }
      if (ctx.degradado) respuesta.aviso = 'preferencias no disponibles: se consultó todo'
      return respuesta
    },

    /** Catálogo de lugares. Lo sirve el servicio de vuelos, que es el
     *  dueño del padrón de aeropuertos. */
    'GET /api/lugares': async () => {
      try {
        const { ok, datos } = await pedirJson(`${urlDe('vuelos')}/api/lugares`, {
          timeoutMs: CONFIG.timeouts.vertical,
        })
        if (!ok) throw new Error('respuesta no ok')
        return datos
      } catch (error) {
        throw new ErrorHttp(503, {
          error: 'el catálogo de lugares no está disponible',
          motivo: error?.motivo ?? 'error',
        })
      }
    },

    'GET /api/perfil': ({ headers }) => proxyUsuarios('/api/perfil', { headers }),
    'PUT /api/perfil': ({ headers, cuerpo }) =>
      proxyUsuarios('/api/perfil', { metodo: 'PUT', cuerpo, headers }),

    'GET /api/admin/config': ({ headers }) => proxyUsuarios('/api/admin/config', { headers }),
    'PUT /api/admin/config/:vertical': ({ params, cuerpo, headers }) =>
      proxyUsuarios(`/api/admin/config/${params.vertical}`, { metodo: 'PUT', cuerpo, headers }),

    'GET /api/admin/preferencias-agregadas': ({ headers }) =>
      proxyUsuarios('/api/admin/preferencias-agregadas', { headers }),
    'GET /api/admin/auditoria': ({ headers }) => proxyUsuarios('/api/admin/auditoria', { headers }),

    /**
     * Interruptor de fallos, para la demostración. Reenvía al vertical
     * el estado de salud simulado que se le quiere imponer. Código de
     * demo: se borra junto con el panel cuando haya contenedores.
     */
    'PUT /api/demo/salud/:vertical': async ({ params, cuerpo }) => {
      const { vertical } = params
      if (!VERTICALES.includes(vertical)) throw new ErrorHttp(404, `vertical desconocido: ${vertical}`)
      try {
        const { ok, estado, datos } = await pedirJson(`${urlDe(vertical)}/demo/salud`, {
          metodo: 'PUT',
          cuerpo,
          timeoutMs: 1000,
        })
        return ok ? datos : conEstado(estado, datos)
      } catch (error) {
        throw new ErrorHttp(503, {
          error: `no se pudo hablar con ${vertical}`,
          motivo: error?.motivo ?? 'error',
        })
      }
    },
  },
})
