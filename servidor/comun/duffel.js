import { CONFIG } from './config.js'

/**
 * Cliente de Duffel, compartido por cualquier vertical que lo use.
 *
 * A diferencia de Amadeus, la autenticación es un token fijo (Bearer),
 * sin OAuth2 ni renovación — lo único que hace falta es mandarlo en
 * cada request junto con `Duffel-Version`, que fija qué versión del
 * schema se espera (Duffel puede cambiarla sin avisar si no se fija).
 */

export class ErrorDuffel extends Error {
  constructor(motivo, detalle) {
    super(`Duffel: ${motivo}`)
    this.name = 'ErrorDuffel'
    this.motivo = motivo // 'sin_credenciales' | 'consulta' | 'timeout'
    this.detalle = detalle
  }
}

/** POST autenticado contra Duffel, con el mismo corte por timeout que
 *  el resto de los proveedores externos. `ruta` ya incluye la query
 *  string si hace falta (ej. `?return_offers=true`). */
export async function consultarDuffel(ruta, cuerpo) {
  const { token, base } = CONFIG.duffel
  if (!token) {
    throw new ErrorDuffel('sin_credenciales', 'falta DUFFEL_ACCESS_TOKEN (ver docs/proveedor-externo.md)')
  }

  const control = new AbortController()
  const cortar = setTimeout(
    () => control.abort(new DOMException('timeout', 'TimeoutError')),
    CONFIG.timeouts.duffel,
  )
  try {
    const res = await fetch(`${base}${ruta}`, {
      method: 'POST',
      signal: control.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'duffel-version': 'v2',
      },
      body: JSON.stringify({ data: cuerpo }),
    })
    if (!res.ok) {
      const cuerpoError = await res.json().catch(() => null)
      throw new ErrorDuffel('consulta', `HTTP ${res.status}: ${cuerpoError?.errors?.[0]?.message ?? ''}`)
    }
    const { data } = await res.json()
    return data
  } catch (error) {
    if (error instanceof ErrorDuffel) throw error
    if (error?.name === 'TimeoutError') throw new ErrorDuffel('timeout', ruta)
    throw new ErrorDuffel('consulta', error?.message)
  } finally {
    clearTimeout(cortar)
  }
}
