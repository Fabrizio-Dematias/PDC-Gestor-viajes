import { CONFIG, VERTICALES } from '../comun/config.js'
import { conEstado, crearServicio, ErrorHttp } from '../comun/http.js'
import { firmar, verificar as verificarToken } from '../comun/jwt.js'
import { LlamadaFallida, pedirJson } from '../comun/pedir.js'
import {
  breakerAbierto,
  breakerRegistrarExito,
  breakerRegistrarFallo,
  cacheGuardar,
  cacheLeer,
} from '../comun/redis.js'

/**
 * El agregador — el API Gateway del nodo central
 * (docs/arquitectura-multi-nodo.md §2).
 *
 * No calcula nada propio: decide a quién llamar, los llama a todos a la
 * vez, y arma una respuesta con lo que haya llegado dentro del
 * presupuesto de tiempo. Todo el valor está en qué hace cuando algo no
 * llega — ahora también cuándo dejar de intentar (circuit breaker) y
 * qué mostrar mientras tanto (caché), los dos en Redis (§9 del
 * contrato).
 *
 * También hace de puerta de entrada única para el front (perfil y
 * administración se proxean hacia el servicio de usuarios), y es acá
 * donde vive la sesión (§10): emite y verifica el JWT, así que es el
 * único lugar de todo el sistema que necesita el secreto. `usuarios`
 * sigue sin saber qué es un token — recibe `x-usuario-id`/`x-agencia-id`
 * ya resueltos, igual que siempre.
 */

if (CONFIG.jwt.secreto === 'clave-de-desarrollo-cambiar-en-produccion') {
  console.warn('[agregador] JWT_SECRET no está fijado — usando el secreto de desarrollo, no usar así en producción')
}

/** Agencia con la que se resuelve una request que no manda
 *  `x-agencia-id` — ver docs/contrato-agregador.md §8. */
const AGENCIA_POR_DEFECTO = 'ag-demo'
/** Presupuesto para leer preferencias/login. Ver
 *  servidor/comun/config.js: por defecto asume Postgres local, se
 *  ajusta por env si el central está en un Postgres alojado. */
const TIMEOUT_CONTEXTO = CONFIG.timeouts.contexto

const urlDe = (vertical) => CONFIG[vertical].url
const queAgencia = (headers) => headers['x-agencia-id'] ?? AGENCIA_POR_DEFECTO

/**
 * La identidad ya no viaja en una cabecera que el cliente puede
 * inventar: viaja en un JWT que el propio agregador firmó al loguear.
 * `null` es un invitado legítimo, no un error — la búsqueda tiene que
 * funcionar igual sin sesión (contrato §10).
 */
function sesionDe(headers) {
  const cabecera = headers.authorization ?? ''
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null
  const payload = verificarToken(token)
  if (!payload) return null
  return { usuarioId: payload.sub, rol: payload.rol, agenciaId: payload.agencia_id, permisos: payload.permisos ?? [] }
}

function requerirSesion(headers) {
  const sesion = sesionDe(headers)
  if (!sesion) throw new ErrorHttp(401, { error: 'hace falta iniciar sesión', motivo: 'sin_sesion' })
  return sesion
}

function requerirAdmin(headers, permiso) {
  const sesion = requerirSesion(headers)
  if (sesion.rol !== 'admin') throw new ErrorHttp(403, { error: 'requiere rol admin', motivo: 'sin_permiso' })
  if (permiso && !sesion.permisos.includes(permiso)) {
    throw new ErrorHttp(403, { error: `requiere el permiso ${permiso}`, motivo: 'sin_permiso' })
  }
  return sesion
}

/**
 * Preferencias del usuario + configuración del administrador de esta
 * agencia. `usuarioId` puede ser `undefined` (invitado): en ese caso ni
 * se pregunta por un perfil que no existe, y las preferencias quedan
 * "todo activado" directamente — buscar sin cuenta tiene que andar
 * igual de bien que con una.
 *
 * Si el servicio de usuarios no responde, **se falla abierto**: se
 * asume que todo está habilitado. Es la decisión menos mala. Fallar
 * cerrado dejaría al usuario sin ninguna sección por una caída que no
 * tiene nada que ver con vuelos ni con hospedaje — convertiría el fallo
 * de un servicio secundario en una caída total, que es exactamente lo
 * que este sistema existe para evitar.
 */
async function contexto(usuarioId, agenciaId) {
  const headersAgencia = { 'x-agencia-id': agenciaId }
  try {
    if (!usuarioId) {
      const config = await pedirJson(`${CONFIG.usuarios.url}/api/admin/config`, {
        timeoutMs: TIMEOUT_CONTEXTO,
        headers: headersAgencia,
      })
      return { config: config.datos ?? {}, preferencias: {}, degradado: false }
    }
    const [config, perfil] = await Promise.all([
      pedirJson(`${CONFIG.usuarios.url}/api/admin/config`, { timeoutMs: TIMEOUT_CONTEXTO, headers: headersAgencia }),
      pedirJson(`${CONFIG.usuarios.url}/api/perfil`, {
        timeoutMs: TIMEOUT_CONTEXTO,
        headers: { ...headersAgencia, 'x-usuario-id': usuarioId },
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

/**
 * Redis es un mecanismo secundario: si no responde, el agregador falla
 * abierto con él también (breaker inactivo, sin caché) y la búsqueda
 * sigue funcionando exactamente como sin Redis — ver contrato §9.
 */
async function circuitoAbierto(agenciaId, vertical) {
  try {
    return await breakerAbierto(agenciaId, vertical)
  } catch (error) {
    console.warn(`[agregador] redis no responde (${error.message}): breaker se ignora`)
    return false
  }
}
async function registrarResultado(agenciaId, vertical, exito) {
  try {
    await (exito ? breakerRegistrarExito(agenciaId, vertical) : breakerRegistrarFallo(agenciaId, vertical))
  } catch (error) {
    console.warn(`[agregador] redis no responde (${error.message}): breaker se ignora`)
  }
}
async function guardarEnCache(agenciaId, vertical, items) {
  try {
    await cacheGuardar(agenciaId, vertical, items)
  } catch (error) {
    console.warn(`[agregador] redis no responde (${error.message}): no se guarda caché`)
  }
}
/** El "cuarto caso" del contrato §5: si hay caché vigente, se responde
 *  `ok` con ella en vez de `unavailable`, declarando su antigüedad. */
async function conCacheOFallback(agenciaId, vertical, motivo) {
  try {
    const cache = await cacheLeer(agenciaId, vertical)
    if (cache) return { estado: 'ok', items: cache.items, cacheado: true, edadMs: cache.edadMs }
  } catch (error) {
    console.warn(`[agregador] redis no responde (${error.message}): sin caché de respaldo`)
  }
  return { estado: 'unavailable', motivo }
}

/**
 * Nunca lanza: un vertical que falla es un resultado, no una excepción.
 *
 * La caché sólo entra en juego cuando el circuito ya está abierto —no
 * en el primer fallo aislado—: un 503 o un timeout sueltos tienen que
 * seguir viéndose como `unavailable`, que es la demostración central
 * del proyecto (tres estados, Módulo 1). Mostrar datos viejos recién
 * tiene sentido cuando ya se dejó de intentar de verdad.
 */
async function consultar(vertical, query, agenciaId) {
  if (await circuitoAbierto(agenciaId, vertical)) {
    return conCacheOFallback(agenciaId, vertical, 'circuito_abierto')
  }

  const url = `${urlDe(vertical)}/api/${vertical}?${new URLSearchParams(query)}`
  try {
    const { ok, datos } = await pedirJson(url, { timeoutMs: CONFIG.timeouts.vertical })
    if (!ok) {
      await registrarResultado(agenciaId, vertical, false)
      return { estado: 'unavailable', motivo: datos?.motivo ?? 'error' }
    }
    if (!Array.isArray(datos?.items)) {
      console.error(`[agregador] ${vertical} respondió 200 sin items: rompe el contrato`)
      await registrarResultado(agenciaId, vertical, false)
      return { estado: 'unavailable', motivo: 'error' }
    }
    await registrarResultado(agenciaId, vertical, true)
    await guardarEnCache(agenciaId, vertical, datos.items)
    return { estado: 'ok', items: datos.items }
  } catch (error) {
    const motivo = error instanceof LlamadaFallida ? error.motivo : 'error'
    console.warn(`[agregador] ${vertical} → ${motivo}`)
    await registrarResultado(agenciaId, vertical, false)
    return { estado: 'unavailable', motivo }
  }
}

async function resolver(vertical, query, ctx, agenciaId) {
  const decision = decidir(vertical, ctx)
  if (!decision.llamar) return { estado: 'unavailable', motivo: decision.motivo }
  return consultar(vertical, query, agenciaId)
}

function criterios(query) {
  const { origen, destino, ida, vuelta, pasajeros } = query
  if (!destino) throw new ErrorHttp(400, 'falta el parámetro destino')
  if (!ida) throw new ErrorHttp(400, 'falta el parámetro ida')
  return Object.fromEntries(
    Object.entries({ origen, destino, ida, vuelta, pasajeros }).filter(([, v]) => v),
  )
}

/** Reenvía una llamada al servicio de usuarios con la identidad ya
 *  resuelta (de la sesión verificada, no de lo que mande el cliente). */
async function proxyUsuarios(ruta, { metodo = 'GET', cuerpo, usuarioId, agenciaId } = {}) {
  try {
    const { ok, estado, datos } = await pedirJson(`${CONFIG.usuarios.url}${ruta}`, {
      metodo,
      cuerpo,
      timeoutMs: TIMEOUT_CONTEXTO,
      headers: {
        ...(usuarioId ? { 'x-usuario-id': usuarioId } : {}),
        'x-agencia-id': agenciaId ?? AGENCIA_POR_DEFECTO,
      },
    })
    return ok ? datos : conEstado(estado, datos)
  } catch (error) {
    throw new ErrorHttp(503, {
      error: 'el servicio de usuarios no está disponible',
      motivo: error?.motivo ?? 'error',
    })
  }
}

/** Login (§10): usuarios valida credenciales, acá se firma el token. */
async function loguear(identificador, password) {
  const { ok, estado, datos } = await pedirJson(`${CONFIG.usuarios.url}/api/auth/verificar-credenciales`, {
    metodo: 'POST',
    cuerpo: { identificador, password },
    timeoutMs: TIMEOUT_CONTEXTO,
  })
  if (!ok) return conEstado(estado, datos)
  return { token: firmar({ sub: datos.id, rol: datos.rol, agencia_id: datos.agencia_id, permisos: datos.permisos }, CONFIG.jwt.ttlSeg), usuario: datos }
}

crearServicio({
  nombre: 'agregador',
  puerto: CONFIG.agregador.puerto,
  rutas: {
    /** Estado de todo el sistema, de un vistazo. */
    'GET /salud': async () => {
      const servicios = await Promise.all(
        ['vuelos', 'hospedaje', 'traslado', 'usuarios'].map(async (s) => {
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

    /** Branding + verticales habilitados de la agencia que resuelve la
     *  cabecera. Lo pide el front al arrancar (contrato §8). Abierta a
     *  invitados: hace falta antes de que exista ninguna sesión. */
    'GET /api/tenant/config': async ({ headers }) => {
      const agenciaId = queAgencia(headers)
      try {
        const { ok, estado, datos } = await pedirJson(`${CONFIG.usuarios.url}/api/agencias/${agenciaId}`, {
          timeoutMs: TIMEOUT_CONTEXTO,
        })
        return ok ? datos : conEstado(estado, datos)
      } catch (error) {
        throw new ErrorHttp(503, {
          error: 'la configuración de la agencia no está disponible',
          motivo: error?.motivo ?? 'error',
        })
      }
    },

    /** La usa un nodo de agencia para sincronizar su bitácora local
     *  (contrato §8, servidor/nodo-agencia/). No la usa el front. */
    'POST /api/agencias/:id/registro': async ({ params, cuerpo }) => {
      try {
        const { ok, estado, datos } = await pedirJson(
          `${CONFIG.usuarios.url}/api/agencias/${params.id}/registro`,
          { metodo: 'POST', cuerpo, timeoutMs: TIMEOUT_CONTEXTO },
        )
        return ok ? datos : conEstado(estado, datos)
      } catch (error) {
        throw new ErrorHttp(503, {
          error: 'no se pudo sincronizar el registro',
          motivo: error?.motivo ?? 'error',
        })
      }
    },

    // --- Login (contrato §10). Abiertas, obviamente: son la forma de
    // conseguir una sesión. `x-agencia-id` decide en qué agencia se
    // registra o a qué agencia queda atado el nuevo administrador. ---

    'POST /api/auth/registro': ({ headers, cuerpo }) =>
      proxyUsuarios('/api/auth/registro', { metodo: 'POST', cuerpo, agenciaId: queAgencia(headers) }),

    'POST /api/auth/reenviar-codigo': ({ cuerpo }) =>
      proxyUsuarios('/api/auth/reenviar-codigo', { metodo: 'POST', cuerpo }),

    /** A diferencia de un proxy común, además firma el token: verificar
     *  el email dispara el login solo, sin pedir la contraseña de nuevo. */
    'POST /api/auth/verificar-email': async ({ cuerpo }) => {
      const { ok, estado, datos } = await pedirJson(`${CONFIG.usuarios.url}/api/auth/verificar-email`, {
        metodo: 'POST',
        cuerpo,
        timeoutMs: TIMEOUT_CONTEXTO,
      })
      if (!ok) return conEstado(estado, datos)
      return {
        token: firmar(
          { sub: datos.id, rol: datos.rol, agencia_id: datos.agencia_id, permisos: datos.permisos },
          CONFIG.jwt.ttlSeg,
        ),
        usuario: datos,
      }
    },

    'POST /api/auth/login': ({ cuerpo }) => loguear(cuerpo?.identificador, cuerpo?.password),

    /**
     * Búsqueda de un vertical. Es la que usa el front: una request por
     * sección, para que cada una pinte apenas tiene su respuesta en vez
     * de esperar a la más lenta. Ver contrato §4. Abierta a invitados.
     */
    'GET /api/buscar/:vertical': async ({ params, query, headers }) => {
      const { vertical } = params
      if (!VERTICALES.includes(vertical)) throw new ErrorHttp(404, `vertical desconocido: ${vertical}`)

      const agenciaId = queAgencia(headers)
      const sesion = sesionDe(headers)
      const ctx = await contexto(sesion?.usuarioId, agenciaId)
      const salida = await resolver(vertical, criterios(query), ctx, agenciaId)
      const generado_en = new Date().toISOString()

      if (salida.estado === 'ok') {
        return {
          vertical,
          estado: 'ok',
          generado_en,
          items: salida.items,
          ...(salida.cacheado ? { cacheado: true, edad_ms: salida.edadMs } : {}),
        }
      }
      return conEstado(503, { vertical, estado: 'unavailable', motivo: salida.motivo, generado_en })
    },

    /**
     * Búsqueda combinada. El front no la usa, pero es la forma canónica
     * del agregador y sirve para probarlo desde `curl` o Postman en la
     * defensa.
     *
     * Siempre responde 200, aunque hayan fallado todos los verticales:
     * el fallo parcial no es un error de la request, es el resultado.
     */
    'GET /api/buscar': async ({ query, headers }) => {
      const criterio = criterios(query)
      const agenciaId = queAgencia(headers)
      const sesion = sesionDe(headers)
      const ctx = await contexto(sesion?.usuarioId, agenciaId)

      // En paralelo, no en serie: el total es el del vertical más lento,
      // no la suma de todos.
      const resultados = await Promise.all(
        VERTICALES.map(async (v) => [v, await resolver(v, criterio, ctx, agenciaId)]),
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

    // --- Perfil y administración: exigen sesión real (§10). La
    // identidad que se le manda a `usuarios` sale de la sesión
    // verificada, nunca de una cabecera que mande el cliente. ---

    'GET /api/perfil': ({ headers }) => {
      const sesion = requerirSesion(headers)
      return proxyUsuarios('/api/perfil', { usuarioId: sesion.usuarioId, agenciaId: sesion.agenciaId })
    },
    'PUT /api/perfil': ({ headers, cuerpo }) => {
      const sesion = requerirSesion(headers)
      return proxyUsuarios('/api/perfil', {
        metodo: 'PUT',
        cuerpo,
        usuarioId: sesion.usuarioId,
        agenciaId: sesion.agenciaId,
      })
    },

    'GET /api/admin/config': ({ headers }) => {
      const sesion = requerirAdmin(headers, 'gestion_verticales')
      return proxyUsuarios('/api/admin/config', { usuarioId: sesion.usuarioId, agenciaId: sesion.agenciaId })
    },
    'PUT /api/admin/config/:vertical': ({ params, cuerpo, headers }) => {
      const sesion = requerirAdmin(headers, 'gestion_verticales')
      return proxyUsuarios(`/api/admin/config/${params.vertical}`, {
        metodo: 'PUT',
        cuerpo,
        usuarioId: sesion.usuarioId,
        agenciaId: sesion.agenciaId,
      })
    },

    'GET /api/admin/preferencias-agregadas': ({ headers }) => {
      const sesion = requerirAdmin(headers)
      return proxyUsuarios('/api/admin/preferencias-agregadas', {
        usuarioId: sesion.usuarioId,
        agenciaId: sesion.agenciaId,
      })
    },
    'GET /api/admin/auditoria': ({ headers }) => {
      const sesion = requerirAdmin(headers)
      return proxyUsuarios('/api/admin/auditoria', { usuarioId: sesion.usuarioId, agenciaId: sesion.agenciaId })
    },

    'GET /api/admin/administradores': ({ headers }) => {
      const sesion = requerirAdmin(headers, 'gestion_usuarios')
      return proxyUsuarios('/api/admin/administradores', {
        usuarioId: sesion.usuarioId,
        agenciaId: sesion.agenciaId,
      })
    },
    'POST /api/admin/administradores': ({ headers, cuerpo }) => {
      const sesion = requerirAdmin(headers, 'gestion_usuarios')
      return proxyUsuarios('/api/admin/administradores', {
        metodo: 'POST',
        cuerpo,
        usuarioId: sesion.usuarioId,
        agenciaId: sesion.agenciaId,
      })
    },
    'PUT /api/admin/administradores/:id/permisos': ({ params, cuerpo, headers }) => {
      const sesion = requerirAdmin(headers, 'gestion_usuarios')
      return proxyUsuarios(`/api/admin/administradores/${params.id}/permisos`, {
        metodo: 'PUT',
        cuerpo,
        usuarioId: sesion.usuarioId,
        agenciaId: sesion.agenciaId,
      })
    },

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
