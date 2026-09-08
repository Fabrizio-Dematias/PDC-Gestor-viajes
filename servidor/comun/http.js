import { createServer } from 'node:http'

/**
 * Servidor HTTP mínimo compartido por los cuatro servicios.
 *
 * Sin framework a propósito: son cuatro procesos que exponen entre dos y
 * cinco rutas cada uno, y en una materia de sistemas distribuidos es más
 * claro que el ruteo y el manejo de errores estén a la vista que
 * escondidos detrás de middlewares.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-usuario-id, x-agencia-id',
}

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

/** Envuelve un cuerpo para devolverlo con un código que no sea 200. */
export function conEstado(estado, cuerpo) {
  return { [MARCA]: true, estado, cuerpo }
}

export function responder(res, estado, cuerpo) {
  const texto = JSON.stringify(cuerpo)
  res.writeHead(estado, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
    ...CORS,
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
 * @param rutas objeto `{ 'GET /api/x/:id': async (ctx) => cuerpo }`.
 *   El handler recibe `{ params, query, cuerpo, headers }` y devuelve el
 *   cuerpo de la respuesta, o `{ estado, cuerpo }` si necesita otro
 *   código que no sea 200.
 */
export function crearServicio({ nombre, puerto, rutas }) {
  const compiladas = Object.entries(rutas).map(([clave, handler]) => ({
    patron: compilar(clave),
    handler,
  }))

  const servidor = createServer(async (req, res) => {
    const arranque = Date.now()
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    const segmentos = url.pathname.split('/').filter(Boolean)

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      return res.end()
    }

    let estado = 200
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
        })

        const envuelta = salida?.[MARCA] === true
        estado = envuelta ? salida.estado : 200
        responder(res, estado, envuelta ? salida.cuerpo : salida)
        return
      }
      estado = 404
      responder(res, 404, { error: `no existe ${req.method} ${url.pathname}` })
    } catch (error) {
      if (error instanceof ErrorHttp) {
        estado = error.estado
        responder(res, error.estado, error.cuerpo)
      } else {
        estado = 500
        console.error(`[${nombre}] error no controlado:`, error)
        responder(res, 500, { error: 'error interno del servicio' })
      }
    } finally {
      const ms = Date.now() - arranque
      console.log(`[${nombre}] ${req.method} ${url.pathname}${url.search} → ${estado} (${ms} ms)`)
    }
  })

  servidor.listen(puerto, () => {
    console.log(`[${nombre}] escuchando en http://localhost:${puerto}`)
  })

  // Sin esto, un Ctrl+C deja el puerto tomado unos segundos y el
  // siguiente arranque falla — molesto justo durante una demostración.
  const cerrar = () => servidor.close(() => process.exit(0))
  process.on('SIGINT', cerrar)
  process.on('SIGTERM', cerrar)

  return servidor
}
