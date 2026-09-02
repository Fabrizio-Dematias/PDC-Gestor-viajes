import { CONFIG } from './config.js'

/**
 * Cliente OAuth2 de Amadeus, compartido por los dos verticales.
 *
 * El token dura ~30 minutos. La renovación es en sí misma un caso de
 * fallo a contemplar: si el refresh se cae en medio de una búsqueda, el
 * vertical no puede responder y tiene que decirlo como cualquier otro
 * fallo, no colgarse esperando.
 */

export class ErrorAmadeus extends Error {
  constructor(motivo, detalle) {
    super(`Amadeus: ${motivo}`)
    this.name = 'ErrorAmadeus'
    this.motivo = motivo // 'sin_credenciales' | 'token' | 'consulta' | 'timeout'
    this.detalle = detalle
  }
}

let cache = null // { valor, venceEn }
let enVuelo = null // evita que N búsquedas simultáneas pidan N tokens

async function pedirToken() {
  const { clave, secreto, base } = CONFIG.amadeus
  if (!clave || !secreto) {
    throw new ErrorAmadeus(
      'sin_credenciales',
      'faltan AMADEUS_CLIENT_ID y AMADEUS_CLIENT_SECRET (ver docs/proveedor-externo.md)',
    )
  }

  const control = new AbortController()
  const cortar = setTimeout(
    () => control.abort(new DOMException('timeout', 'TimeoutError')),
    CONFIG.timeouts.amadeus,
  )
  try {
    const res = await fetch(`${base}/v1/security/oauth2/token`, {
      method: 'POST',
      signal: control.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clave,
        client_secret: secreto,
      }),
    })
    if (!res.ok) throw new ErrorAmadeus('token', `HTTP ${res.status}`)

    const { access_token: valor, expires_in: segundos } = await res.json()
    // Se renueva un minuto antes de que venza: si esperáramos al
    // vencimiento exacto, una búsqueda podría salir con un token que
    // expira mientras viaja.
    cache = { valor, venceEn: Date.now() + (segundos - 60) * 1000 }
    return valor
  } catch (error) {
    if (error instanceof ErrorAmadeus) throw error
    if (error?.name === 'TimeoutError') throw new ErrorAmadeus('timeout', 'el token tardó demasiado')
    throw new ErrorAmadeus('token', error?.message)
  } finally {
    clearTimeout(cortar)
  }
}

export async function obtenerToken() {
  if (cache && Date.now() < cache.venceEn) return cache.valor
  if (enVuelo) return enVuelo
  enVuelo = pedirToken().finally(() => {
    enVuelo = null
  })
  return enVuelo
}

/** GET autenticado contra Amadeus, con el mismo corte por timeout. */
export async function consultarAmadeus(ruta, parametros) {
  const token = await obtenerToken()
  const url = `${CONFIG.amadeus.base}${ruta}?${new URLSearchParams(parametros)}`

  const control = new AbortController()
  const cortar = setTimeout(
    () => control.abort(new DOMException('timeout', 'TimeoutError')),
    CONFIG.timeouts.amadeus,
  )
  try {
    const res = await fetch(url, {
      signal: control.signal,
      headers: { authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      // El token venció antes de lo anunciado. Se descarta y se deja que
      // el siguiente intento lo renueve; no se reintenta acá para no
      // gastarse el presupuesto de tiempo de la búsqueda en curso.
      cache = null
      throw new ErrorAmadeus('token', 'token rechazado (401)')
    }
    if (!res.ok) throw new ErrorAmadeus('consulta', `HTTP ${res.status}`)
    return await res.json()
  } catch (error) {
    if (error instanceof ErrorAmadeus) throw error
    if (error?.name === 'TimeoutError') throw new ErrorAmadeus('timeout', ruta)
    throw new ErrorAmadeus('consulta', error?.message)
  } finally {
    clearTimeout(cortar)
  }
}

/** "PT12H35M" → 755 */
export function duracionAMinutos(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(iso ?? '')
  if (!m) return 0
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
}
