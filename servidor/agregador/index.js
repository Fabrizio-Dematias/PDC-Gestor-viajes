import { createHash } from 'node:crypto'
import { CONFIG, presupuestoDe, VERTICALES } from '../comun/config.js'
import { conFailover, instanciasConocidas, iniciarDescubrimiento, registroDisponible, urlServicio } from '../comun/descubrimiento.js'
import { conEstado, conTexto, conVersion, crearServicio, ErrorHttp } from '../comun/http.js'
import { firmar, verificar as verificarToken } from '../comun/jwt.js'
import { pedirJson } from '../comun/pedir.js'
import { contexto, invalidarConfig, invalidarPerfil } from './contexto.js'
import { OPENAPI } from './openapi.js'
import { leerReserva, reservar } from './reservas.js'
import {
  breakerAbierto,
  breakerRegistrarExito,
  breakerRegistrarFallo,
  cacheGuardar,
  cacheLeer,
  estadoDeCola,
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

const urlDe = (servicio) => urlServicio(servicio)

// A quién llamar lo decide el registro de servicios (Módulo 4): cada
// pocos segundos se baja la lista de instancias sanas y `urlDe` reparte
// entre ellas. Si el registro no responde, se usan las direcciones fijas
// de config.js — ver servidor/comun/descubrimiento.js.
iniciarDescubrimiento()

/**
 * De qué agencia es esta request. Con sesión, la agencia es la del
 * token verificado — nunca la del header, que el cliente puede mandar
 * con cualquier valor. Antes esto no era así: un usuario logueado de
 * ag-sur que pegara contra un front desplegado con `x-agencia-id:
 * ag-demo` (el caso de una sola instancia sirviendo a varias agencias,
 * en vez de un despliegue por agencia) terminaba viendo — y
 * modificando — la configuración de ag-demo, no la suya. La marca
 * blanca depende de esto: quién sos ya decide de qué agencia sos, la
 * cabecera sólo importa para quien todavía no inició sesión.
 */
const queAgencia = (headers, sesion) => sesion?.agenciaId ?? headers['x-agencia-id'] ?? AGENCIA_POR_DEFECTO

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
async function guardarEnCache(agenciaId, vertical, huella, items) {
  try {
    await cacheGuardar(agenciaId, vertical, huella, items)
  } catch (error) {
    console.warn(`[agregador] redis no responde (${error.message}): no se guarda caché`)
  }
}
/** El "cuarto caso" del contrato §5: si hay caché vigente, se responde
 *  `ok` con ella en vez de `unavailable`, declarando su antigüedad. */
async function conCacheOFallback(agenciaId, vertical, huella, motivo) {
  try {
    const cache = await cacheLeer(agenciaId, vertical, huella)
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
/** Identifica una búsqueda (sus criterios) para la caché: dos pedidos
 *  iguales dan la misma huella aunque los parámetros lleguen en otro
 *  orden. */
const huellaDe = (query) =>
  createHash('sha1')
    .update(JSON.stringify(Object.entries(query).sort(([a], [b]) => a.localeCompare(b))))
    .digest('hex')
    .slice(0, 16)

async function consultar(vertical, query, agenciaId) {
  const huella = huellaDe(query)
  if (await circuitoAbierto(agenciaId, vertical)) {
    return conCacheOFallback(agenciaId, vertical, huella, 'circuito_abierto')
  }

  try {
    // `conFailover` puede lanzar `SinInstancias`: el registro sabe de este
    // servicio y ninguna instancia está lista. Es un fallo como cualquier
    // otro (no se llama a quien dijo "no estoy listo"). Y si la instancia
    // elegida no se puede conectar, prueba con otra antes de rendirse.
    const { ok, estado, datos } = await conFailover(vertical, (base) =>
      pedirJson(`${base}/api/${vertical}?${new URLSearchParams(query)}`, { timeoutMs: presupuestoDe(vertical) }),
    )
    if (!ok) {
      // Un 4xx es el servicio diciendo "esta búsqueda no tiene sentido"
      // (lugar desconocido, mismo origen y destino): el servicio está
      // sano y respondió. No es un fallo, así que no cuenta para el
      // circuit breaker — si contara, tres búsquedas mal armadas
      // dejarían el vertical apagado para todos durante 30 s.
      if (estado >= 400 && estado < 500) return { estado: 'rechazado', http: estado, cuerpo: datos }
      await registrarResultado(agenciaId, vertical, false)
      return { estado: 'unavailable', motivo: datos?.motivo ?? 'error' }
    }
    if (!Array.isArray(datos?.items)) {
      console.error(`[agregador] ${vertical} respondió 200 sin items: rompe el contrato`)
      await registrarResultado(agenciaId, vertical, false)
      return { estado: 'unavailable', motivo: 'error' }
    }
    await registrarResultado(agenciaId, vertical, true)
    await guardarEnCache(agenciaId, vertical, huella, datos.items)
    return { estado: 'ok', items: datos.items }
  } catch (error) {
    const motivo = error?.motivo ?? 'error' // timeout | error | sin_instancias
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
    const { ok, estado, datos } = await pedirJson(`${urlDe('usuarios')}${ruta}`, {
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

/** Llama al servicio de usuarios; si no responde, 503 con el motivo en
 *  vez del 500 genérico que saldría de una excepción sin atrapar. */
async function llamarUsuarios(ruta, opciones) {
  try {
    return await pedirJson(`${urlDe('usuarios')}${ruta}`, { timeoutMs: TIMEOUT_CONTEXTO, ...opciones })
  } catch (error) {
    throw new ErrorHttp(503, {
      error: 'el servicio de usuarios no está disponible',
      motivo: error?.motivo ?? 'error',
    })
  }
}

/** Login (§10): usuarios valida credenciales, acá se firma el token. */
async function loguear(identificador, password) {
  const { ok, estado, datos } = await llamarUsuarios('/api/auth/verificar-credenciales', {
    metodo: 'POST',
    cuerpo: { identificador, password },
  })
  if (!ok) return conEstado(estado, datos)
  return { token: firmar({ sub: datos.id, rol: datos.rol, agencia_id: datos.agencia_id, permisos: datos.permisos }, CONFIG.jwt.ttlSeg), usuario: datos }
}

/**
 * Catálogo de ciudades y aeropuertos para el buscador. Lo sirve vuelos
 * (es el dueño del padrón), pero se guarda una copia en memoria: es un
 * dato estático de casi un megabyte que el front pide en cada carga de
 * página, y si vuelos se cae después de la primera vez el buscador tiene
 * que seguir pudiendo elegir ciudades.
 */
let catalogoEnMemoria = null // { datos, en }
const VIGENCIA_CATALOGO_MS = 60 * 60_000

async function catalogoDeCiudades() {
  if (catalogoEnMemoria && Date.now() - catalogoEnMemoria.en < VIGENCIA_CATALOGO_MS) {
    return catalogoEnMemoria.datos
  }
  try {
    const { ok, datos } = await pedirJson(`${urlDe('vuelos')}/api/ciudades`, {
      timeoutMs: CONFIG.timeouts.vertical,
    })
    if (!ok) throw new Error('respuesta no ok')
    catalogoEnMemoria = { datos, en: Date.now() }
    return datos
  } catch (error) {
    // Vencida, pero mejor que nada.
    if (catalogoEnMemoria) return catalogoEnMemoria.datos
    throw new ErrorHttp(503, {
      error: 'el catálogo de lugares no está disponible',
      motivo: error?.motivo ?? 'error',
    })
  }
}

const PAGINA_DE_DOCUMENTACION = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gestor de viajes — API v1</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>body { margin: 0 } .aviso { padding: .75rem 1rem; font: 14px system-ui; background: #f4f6f9; border-bottom: 1px solid #dfe4ec }</style>
</head>
<body>
  <div class="aviso">Documentación interactiva de la API. La descripción en sí está en
    <a href="/api/v1/openapi.json">/api/v1/openapi.json</a>; esta página carga Swagger UI desde un CDN, así que necesita internet.</div>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>window.ui = SwaggerUIBundle({ url: '/api/v1/openapi.json', dom_id: '#swagger-ui', deepLinking: true })</script>
</body>
</html>`

/** Todo lo que el front y los clientes externos consumen. `conVersion`
 *  lo publica en `/api/v1/…` y deja la ruta sin versión como alias
 *  deprecado (docs/contrato-agregador.md §12). */
const rutasApi = {
  /**
   * Estado de todo el sistema, de un vistazo. Es la vista de detalle
   * (contadores, proveedor, salud simulada) que usa el panel de fallos
   * del front; para saber si un servicio está *vivo* o *listo* están
   * `/salud/live` y `/salud/ready`, que existen en cada uno.
   *
   * El presupuesto de cada sondeo es de 2,5 s, no 1 s como antes: con
   * la base en Supabase el servicio de usuarios tardaba más que eso en
   * contestar y el panel lo marcaba caído estando sano.
   */
  'GET /salud': async () => {
    const servicios = await Promise.all(
      ['vuelos', 'hospedaje', 'traslado', 'usuarios', 'notificaciones'].map(async (s) => {
        try {
          const { ok, datos } = await pedirJson(`${urlDe(s)}/salud`, { timeoutMs: 2500 })
          return [s, ok ? { estado: 'ok', ...datos } : { estado: 'unavailable' }]
        } catch (error) {
          return [s, { estado: 'unavailable', motivo: error?.motivo ?? 'error' }]
        }
      }),
    )
    const cola = await estadoDeCola().catch(() => null)
    return {
      servicio: 'agregador',
      generado_en: new Date().toISOString(),
      servicios: Object.fromEntries(servicios),
      cola,
      descubrimiento: { registro: registroDisponible() ? 'disponible' : 'no_disponible', instancias: instanciasConocidas() },
    }
  },

  /** Branding + verticales habilitados de la agencia — la del usuario
   *  logueado si hay sesión, la de la cabecera si no (contrato §8).
   *  Lo pide el front al arrancar y de nuevo cada vez que cambia la
   *  sesión. Abierta a invitados: hace falta antes de que exista
   *  ninguna sesión. */
  'GET /api/tenant/config': async ({ headers }) => {
    const agenciaId = queAgencia(headers, sesionDe(headers))
    try {
      const { ok, estado, datos } = await pedirJson(`${urlDe('usuarios')}/api/agencias/${agenciaId}`, {
        timeoutMs: TIMEOUT_CONTEXTO,
      })
      // Además de la marca, cuánto espera el agregador a cada vertical:
      // el front se corta un poco después (contrato §3, "cada capa se
      // corta antes que la de arriba"), y con una API externa en vuelos
      // ese número no es el mismo que con la base propia.
      return ok
        ? { ...datos, presupuestos_ms: Object.fromEntries(VERTICALES.map((v) => [v, presupuestoDe(v)])) }
        : conEstado(estado, datos)
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
        `${urlDe('usuarios')}/api/agencias/${params.id}/registro`,
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
    const { ok, estado, datos } = await llamarUsuarios('/api/auth/verificar-email', { metodo: 'POST', cuerpo })
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

    const sesion = sesionDe(headers)
    const agenciaId = queAgencia(headers, sesion)
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
    // El vertical respondió que la búsqueda no es válida: se devuelve
    // el mismo 4xx, no un 503 — no es que "no esté disponible".
    if (salida.estado === 'rechazado') {
      return conEstado(salida.http, {
        vertical,
        estado: 'rejected',
        motivo: salida.cuerpo?.motivo ?? 'solicitud_invalida',
        error: salida.cuerpo?.error,
        generado_en,
      })
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
    const sesion = sesionDe(headers)
    const agenciaId = queAgencia(headers, sesion)
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
        respuesta.no_disponibles.push({
          vertical,
          motivo: salida.estado === 'rechazado' ? (salida.cuerpo?.motivo ?? 'solicitud_invalida') : salida.motivo,
        })
      }
    }
    if (ctx.degradado) respuesta.aviso = 'preferencias no disponibles: se consultó todo'
    return respuesta
  },

  /**
   * Reservar un vuelo (o varios: ida y vuelta, multidestino). Exige la
   * cabecera `Idempotency-Key`. Abierta a invitados, igual que la
   * búsqueda: si hay sesión la reserva queda a nombre de ese usuario.
   * Ver servidor/agregador/reservas.js para el porqué de cada canal.
   */
  'POST /api/reservas': ({ headers, cuerpo }) =>
    reservar({ cuerpo, headers, usuarioId: sesionDe(headers)?.usuarioId }),

  /** La reserva, más el estado del aviso de confirmación (el canal
   *  asíncrono: `enviada` | `pendiente` | `no_disponible`). */
  'GET /api/reservas/:id': ({ params }) => leerReserva(params.id),

  /** Catálogo de ciudades, con sus aeropuertos y si tienen vuelos
   *  (v1). Lo sirve el servicio de vuelos, que es el dueño del padrón. */
  'GET /api/lugares': () => catalogoDeCiudades(),

  // --- Perfil y administración: exigen sesión real (§10). La
  // identidad que se le manda a `usuarios` sale de la sesión
  // verificada, nunca de una cabecera que mande el cliente. ---

  'GET /api/perfil': ({ headers }) => {
    const sesion = requerirSesion(headers)
    return proxyUsuarios('/api/perfil', { usuarioId: sesion.usuarioId, agenciaId: sesion.agenciaId })
  },
  'PUT /api/perfil': async ({ headers, cuerpo }) => {
    const sesion = requerirSesion(headers)
    try {
      return await proxyUsuarios('/api/perfil', {
        metodo: 'PUT',
        cuerpo,
        usuarioId: sesion.usuarioId,
        agenciaId: sesion.agenciaId,
      })
    } finally {
      // El cambio se tiene que ver en la próxima búsqueda, no a los
      // 15 s (ver contexto.js).
      invalidarPerfil(sesion.usuarioId)
    }
  },

  'GET /api/admin/config': ({ headers }) => {
    const sesion = requerirAdmin(headers, 'gestion_verticales')
    return proxyUsuarios('/api/admin/config', { usuarioId: sesion.usuarioId, agenciaId: sesion.agenciaId })
  },
  'PUT /api/admin/config/:vertical': async ({ params, cuerpo, headers }) => {
    const sesion = requerirAdmin(headers, 'gestion_verticales')
    try {
      return await proxyUsuarios(`/api/admin/config/${params.vertical}`, {
        metodo: 'PUT',
        cuerpo,
        usuarioId: sesion.usuarioId,
        agenciaId: sesion.agenciaId,
      })
    } finally {
      invalidarConfig(sesion.agenciaId)
    }
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
   * Lo que ve el registro de servicios: cada instancia, su dirección y
   * si pasa su health check. Sólo administradores — son direcciones
   * internas.
   */
  'GET /api/sistema/servicios': async ({ headers }) => {
    requerirAdmin(headers)
    try {
      const { ok, datos } = await pedirJson(`${CONFIG.registro.url}/api/v1/servicios`, { timeoutMs: 1500 })
      if (!ok) throw new Error('respuesta no ok')
      return { registro: 'disponible', servicios: datos.servicios }
    } catch {
      // Sin registro el sistema sigue andando con las direcciones fijas.
      return { registro: 'no_disponible', servicios: {} }
    }
  },

  /** La descripción formal de esta API (OpenAPI 3). Ver openapi.js. */
  'GET /api/openapi.json': () => OPENAPI,

  /** Documentación interactiva. Swagger UI se carga desde un CDN, así
   *  que la página necesita internet; el documento en sí no. */
  'GET /api/docs': () => conTexto(200, PAGINA_DE_DOCUMENTACION, 'text/html; charset=utf-8'),

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
}

/** `/api/lugares` sin versión es la forma anterior (v0): aeropuertos
 *  sueltos y, por origen, sólo los destinos con vuelo directo. Se
 *  conserva tal cual para quien todavía la consuma — cambiar el cuerpo
 *  de una ruta ya publicada es un cambio que rompe a los clientes
 *  (docs/contrato-agregador.md §12), y para eso existe `/v1`. */
async function lugaresV0({ cabeceras }) {
  cabeceras.deprecation = 'true'
  cabeceras.link = '</api/v1/lugares>; rel="successor-version"'
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
}

crearServicio({
  nombre: 'agregador',
  puerto: CONFIG.agregador.puerto,
  // El agregador no depende de nadie para atender: falla abierto con
  // usuarios y con Redis (contrato §7 y §9) y cae a las direcciones fijas
  // si no hay registro. Por eso siempre está listo; lo que sabe del
  // resto del sistema va como información.
  listo: () => ({ registro: registroDisponible() ? 'disponible' : 'no_disponible' }),
  rutas: { ...conVersion(rutasApi), 'GET /api/lugares': lugaresV0 },
})
