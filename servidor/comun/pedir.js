import { Agent, request as pedirHttp } from 'node:http'
import { request as pedirHttps } from 'node:https'
import { gunzipSync } from 'node:zlib'
import { agenteTls } from './tls.js'
import { idDePedido } from './traza.js'

/**
 * Cliente HTTP entre servicios. Es el único lugar del backend donde se
 * hace una llamada saliente a otro servicio, y por eso es el único que
 * necesita saber de timeouts y de certificados.
 *
 * Usa `node:http`/`node:https` y no `fetch` porque, con `TLS=on`, cada
 * llamada tiene que presentar el certificado de este servicio (TLS
 * mutuo) y verificar al otro contra la CA propia (`tls.js`); `fetch`
 * no deja pasar un certificado de cliente sin sumar una dependencia.
 */

export class LlamadaFallida extends Error {
  constructor(motivo, causa) {
    super(`llamada fallida: ${motivo}`)
    this.name = 'LlamadaFallida'
    this.motivo = motivo // 'timeout' | 'error'
    this.causa = causa
  }
}

/** Conexiones keep-alive también sin TLS, como hacía `fetch`. */
const agentePlano = new Agent({ keepAlive: true })

/**
 * GET/POST/PUT/DELETE con corte por `AbortController`.
 *
 * El timeout no es opcional: un servicio *colgado* —que acepta la
 * conexión y nunca responde— dejaría la promesa viva para siempre y con
 * ella la búsqueda del usuario.
 *
 * Si la llamada se hace dentro de una request que ya tiene identificador
 * (`servidor/comun/traza.js`), se lo manda al servicio de destino en
 * `x-request-id`: así los logs de todos los servicios que tocó una misma
 * búsqueda comparten la misma marca.
 */
export async function pedirJson(url, { timeoutMs, metodo = 'GET', cuerpo, headers } = {}) {
  const control = new AbortController()
  const cortar = timeoutMs ? setTimeout(() => control.abort(), timeoutMs) : null

  const destino = new URL(url)
  const conTls = destino.protocol === 'https:'
  const texto = cuerpo ? JSON.stringify(cuerpo) : undefined
  const id = idDePedido()

  try {
    return await new Promise((resolver, rechazar) => {
      const req = (conTls ? pedirHttps : pedirHttp)(
        destino,
        {
          method: metodo,
          signal: control.signal,
          agent: conTls ? agenteTls() : agentePlano,
          headers: {
            'accept-encoding': 'gzip',
            ...(texto ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(texto) } : {}),
            ...(id ? { 'x-request-id': id } : {}),
            ...headers,
          },
        },
        (res) => {
          const trozos = []
          res.on('data', (t) => trozos.push(t))
          res.on('error', rechazar)
          res.on('end', () => {
            let datos = null
            try {
              let crudo = Buffer.concat(trozos)
              if (res.headers['content-encoding'] === 'gzip') crudo = gunzipSync(crudo)
              datos = JSON.parse(crudo.toString('utf8'))
            } catch {
              // Sin cuerpo o no es JSON: lo decide quien llama con `estado`.
            }
            const estado = res.statusCode
            resolver({ ok: estado >= 200 && estado < 300, estado, datos, cabeceras: res.headers })
          })
        },
      )
      req.on('error', rechazar)
      req.end(texto)
    })
  } catch (error) {
    if (control.signal.aborted) throw new LlamadaFallida('timeout', error)
    throw new LlamadaFallida('error', error)
  } finally {
    if (cortar) clearTimeout(cortar)
  }
}
