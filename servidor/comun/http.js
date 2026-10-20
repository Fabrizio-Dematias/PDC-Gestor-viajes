import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { registrarServicio } from './descubrimiento.js'
import { conIdDePedido } from './traza.js'

/**
 * Servidor HTTP mínimo compartido por todos los servicios.
 *
 * Sin framework a propósito: son procesos que exponen entre dos y
 * quince rutas cada uno, y en una materia de sistemas distribuidos es
 * más claro que el ruteo y el manejo de errores estén a la vista que
 * escondidos detrás de middlewares.
 *
 * Lo que sí hace por todos (Módulo 4: la capa que se intercala entre el
 * código de negocio y la red, y que el código de negocio no necesita
 * conocer):
 *
 * - **Salud**: `GET /salud/live` y `GET /salud/ready` en todos los
 *   servicios (ver `crearServicio`).
 * - **Identificador de request**: lo lee de `x-request-id` o lo genera,
 *   lo devuelve en la respuesta, lo imprime en el log y lo reenvía a
 *   cada servicio al que llama (`traza.js`, `pedir.js`).
 * - **Compresión**: gzip para las respuestas JSON grandes cuando el
 *   cliente lo acepta (el catálogo de ciudades pasa de ~900 KB a ~150).
 * - **Versionado**: `conVersion` (más abajo).
 * - **Registro de servicios**: al arrancar se anota en
 *   `servidor/registro/` (con su nombre, su dirección y un latido
 *   periódico) para que los demás lo descubran sin direcciones fijas; al
 *   cerrarse se da de baja.
 * - **Cierre ordenado**: al recibir SIGTERM deja de declararse listo,
 *   avisa a quien corresponda (`alCerrar`) y recién entonces cierra.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers':
    'content-type, authorization, idempotency-key, x-usuario-id, x-agencia-id, x-request-id',
  'access-control-expose-headers': 'x-request-id, deprecation, link, retry-after',
}

/** Por debajo de esto comprimir cuesta más CPU de lo que ahorra en red. */
const UMBRAL_GZIP = 2048

/**
 * Marca para distinguir "el handler quiere otro código HTTP" de "el
 * handler devolvió un cuerpo".
 *
 * No alcanza con mirar si el objeto trae una clave `estado`: el contrato
 * del agregador usa `estado` para el estado del vertical
 * (`ok`/`unavailable`), así que una respuesta legítima de búsqueda se
 * confundiría con un código de estado HTTP.
 */
const MARCA = Symbol('respuesta-http')

/** Envuelve un cuerpo para devolverlo con un código que no sea 200
 *  (y, si hace falta, con cabeceras propias). */
export function conEstado(estado, cuerpo, cabeceras) {
  return { [MARCA]: true, estado, cuerpo, cabeceras }
}

/** Una respuesta que no es JSON (la página de documentación de la API,
 *  por ejemplo): se manda `texto` tal cual, con su `tipo` de contenido. */
export function conTexto(estado, texto, tipo = 'text/plain; charset=utf-8', cabeceras) {
  return { [MARCA]: true, estado, cuerpo: texto, cabeceras, tipo }
}

export function responder(res, estado, cuerpo, { cabeceras, aceptaGzip, tipo } = {}) {
  let texto = Buffer.from(tipo ? String(cuerpo) : JSON.stringify(cuerpo))
  const extra = {}
  if (aceptaGzip && texto.length > UMBRAL_GZIP) {
    texto = gzipSync(texto)
    extra['content-encoding'] = 'gzip'
  }
  res.writeHead(estado, {
    'content-type': tipo ?? 'application/json; charset=utf-8',
    'content-length': texto.length,
    vary: 'accept-encoding',
    ...CORS,
    ...cabeceras,
    ...extra,
  })
  res.end(texto)
}

/**
 * Error que un handler puede lanzar para responder con un estado
 * concreto. Cualquier otra excepción es un bug y sale como 500.
 */
export class ErrorHttp extends Error {
  constructor(estado, cuerpo) {
    super(typeof cuerpo === 'string' ? cuerpo : cuerpo?.error ?? 'error')
    this.estado = estado
    this.cuerpo = typeof cuerpo === 'string' ? { error: cuerpo } : cuerpo
  }
}

/** `GET /api/buscar/:vertical` → { metodo, segmentos: ['api','buscar',':vertical'] } */
function compilar(clave) {
  const [metodo, ruta] = clave.split(' ')
  return { metodo, segmentos: ruta.split('/').filter(Boolean) }
}

function emparejar(patron, metodo, segmentos) {
  if (patron.metodo !== metodo) return null
  if (patron.segmentos.length !== segmentos.length) return null
  const params = {}
  for (const [i, esperado] of patron.segmentos.entries()) {
    if (esperado.startsWith(':')) params[esperado.slice(1)] = decodeURIComponent(segmentos[i])
    else if (esperado !== segmentos[i]) return null
  }
  return params
}

async function leerCuerpo(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const trozos = []
  for await (const t of req) trozos.push(t)
  if (trozos.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(trozos).toString('utf8'))
  } catch {
    throw new ErrorHttp(400, 'el cuerpo no es JSON válido')
  }
}

/**
 * Versionado de la API pública (Módulo 4, "versionado de contratos"):
 * cada ruta `/api/x` pasa a vivir en `/api/<version>/x`, y la ruta sin
 * versión se conserva como **alias deprecado** — responde lo mismo pero
 * avisa con las cabeceras `Deprecation` y `Link: rel="successor-version"`
 * (RFC 8594 / draft-ietf-httpapi-deprecation-header). Un cliente viejo
 * sigue andando; uno nuevo ya sabe adónde mudarse.
 *
 * Las rutas que no empiezan con `/api/` (`/salud`, `/salud/live`…) son
 * operativas y no se versionan: las consulta la infraestructura, no los
 * clientes de la API.
 *
 * Una ruta sin versión que cambió de forma (es el caso de `/api/lugares`)
 * se pisa después con su implementación anterior:
 * `{ ...conVersion(rutas), 'GET /api/lugares': lugaresV0 }`.
 */
export function conVersion(rutas, version = 'v1') {
  const salida = {}
  for (const [clave, handler] of Object.entries(rutas)) {
    const [metodo, ruta] = clave.split(' ')
    if (!ruta.startsWith('/api/')) {
      salida[clave] = handler
      continue
    }
    salida[`${metodo} /api/${version}/${ruta.slice('/api/'.length)}`] = handler
    salida[clave] = (ctx) => {
      ctx.cabeceras.deprecation = 'true'
      ctx.cabeceras.link = `<${ctx.req.url.replace(/^\/api\//, `/api/${version}/`)}>; rel="successor-version"`
      return handler(ctx)
    }
  }
  return salida
}

/**
 * @param rutas objeto `{ 'GET /api/x/:id': async (ctx) => cuerpo }`.
 *   El handler recibe `{ params, query, cuerpo, headers, req, cabeceras }`
 *   y devuelve el cuerpo de la respuesta, o `conEstado(código, cuerpo)`
 *   si necesita otro código que no sea 200. `cabeceras` es un objeto
 *   donde el handler puede dejar cabeceras de respuesta.
 * @param listo función opcional (async) para `GET /salud/ready`: debe
 *   resolver si el servicio puede atender tráfico ahora (base abierta,
 *   dependencias alcanzables) o lanzar si no. Sin ella el servicio se
 *   declara listo apenas arranca.
 * @param alArrancar se llama cuando el puerto ya está escuchando
 *   (por ejemplo, para registrarse en el registro de servicios).
 * @param alCerrar se llama al recibir SIGTERM/SIGINT, antes de cerrar
 *   (por ejemplo, para cerrar conexiones).
 * @param registrar si el servicio se anota en el registro de servicios
 *   (por defecto sí; el propio registro no).
 * @param rutasSilenciosas prefijos de ruta que no se anotan en el log
 *   cuando salen bien: las que se llaman cada pocos segundos (latidos,
 *   sondeos) taparían todo lo demás.
 */
export function crearServicio({ nombre, puerto, rutas, listo, alArrancar, alCerrar, registrar = true, rutasSilenciosas = [] }) {
  let cerrando = false
  let registro = null

  /**
   * Liveness y readiness (Módulo 4, "health checks"): dos preguntas
   * distintas con dos consecuencias distintas.
   *
   * - `live` — ¿el proceso responde? Si no, hay que reiniciarlo. **No
   *   depende de nada externo**: si dependiera de la base, una caída de
   *   la base reiniciaría a todos los servicios sin motivo.
   * - `ready` — ¿puede atender tráfico *ahora*? Si no, se lo saca del
   *   reparto pero no se lo reinicia (está cargando, o su base no
   *   contesta). Acá sí se consultan las dependencias.
   *
   * `GET /salud` sigue existiendo en cada servicio con el detalle
   * (contadores, proveedor) — es lo que usa el panel del front.
   */
  const operativas = {
    'GET /salud/live': () => ({ servicio: nombre, estado: 'vivo' }),
    'GET /salud/ready': async () => {
      if (cerrando) throw new ErrorHttp(503, { servicio: nombre, estado: 'cerrando' })
      try {
        const detalle = await Promise.race([
          Promise.resolve(listo ? listo() : true),
          new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('timeout')), 2000)),
        ])
        return { servicio: nombre, estado: 'listo', ...(detalle && typeof detalle === 'object' ? detalle : {}) }
      } catch (error) {
        throw new ErrorHttp(503, { servicio: nombre, estado: 'no_listo', motivo: error?.message ?? 'error' })
      }
    },
  }

  const compiladas = Object.entries({ ...operativas, ...rutas }).map(([clave, handler]) => ({
    patron: compilar(clave),
    handler,
  }))

  const servidor = createServer(async (req, res) => {
    const arranque = Date.now()
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    const segmentos = url.pathname.split('/').filter(Boolean)
    const idPedido = String(req.headers['x-request-id'] ?? randomUUID().slice(0, 8)).slice(0, 64)
    const aceptaGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      return res.end()
    }

    let estado = 200
    const cabeceras = { 'x-request-id': idPedido }
    await conIdDePedido(idPedido, async () => {
      try {
        for (const { patron, handler } of compiladas) {
          const params = emparejar(patron, req.method, segmentos)
          if (!params) continue

          const salida = await handler({
            params,
            query: Object.fromEntries(url.searchParams),
            cuerpo: await leerCuerpo(req),
            headers: req.headers,
            req,
            cabeceras,
          })

          const envuelta = salida?.[MARCA] === true
          estado = envuelta ? salida.estado : 200
          responder(res, estado, envuelta ? salida.cuerpo : salida, {
            cabeceras: { ...cabeceras, ...(envuelta ? salida.cabeceras : {}) },
            aceptaGzip,
            tipo: envuelta ? salida.tipo : undefined,
          })
          return
        }
        estado = 404
        responder(res, 404, { error: `no existe ${req.method} ${url.pathname}` }, { cabeceras, aceptaGzip })
      } catch (error) {
        if (error instanceof ErrorHttp) {
          estado = error.estado
          responder(res, error.estado, error.cuerpo, { cabeceras, aceptaGzip })
        } else {
          estado = 500
          console.error(`[${nombre}] error no controlado (#${idPedido}):`, error)
          responder(res, 500, { error: 'error interno del servicio' }, { cabeceras, aceptaGzip })
        }
      } finally {
        const ms = Date.now() - arranque
        // Las sondas de salud van cada pocos segundos y taparían todo lo
        // demás en el log.
        const silenciosa = estado < 400 && rutasSilenciosas.some((p) => url.pathname.startsWith(p))
        if (!url.pathname.startsWith('/salud') && !silenciosa) {
          console.log(`[${nombre}] ${req.method} ${url.pathname}${url.search} → ${estado} (${ms} ms) #${idPedido}`)
        }
      }
    })
  })

  servidor.listen(puerto, () => {
    console.log(`[${nombre}] escuchando en http://localhost:${puerto}`)
    if (registrar) registro = registrarServicio({ nombre, puerto })
    alArrancar?.()
  })

  // Sin esto, un Ctrl+C deja el puerto tomado unos segundos y el
  // siguiente arranque falla — molesto justo durante una demostración.
  const cerrar = async () => {
    if (cerrando) return
    cerrando = true
    // Primero se avisa que ya no se atiende (así dejan de mandar tráfico) y
    // recién después se cierra.
    await registro?.baja()
    try {
      await alCerrar?.()
    } catch {
      // Lo que haga `alCerrar` no puede impedir que el servicio cierre.
    }
    servidor.close(() => process.exit(0))
    // Las conexiones keep-alive mantendrían vivo el servidor.
    servidor.closeIdleConnections?.()
    setTimeout(() => process.exit(0), 1500).unref()
  }
  process.on('SIGINT', cerrar)
  process.on('SIGTERM', cerrar)

  return servidor
}
