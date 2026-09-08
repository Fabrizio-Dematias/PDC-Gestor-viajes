import { createHmac, timingSafeEqual } from 'node:crypto'
import { CONFIG } from './config.js'

/**
 * JWT (HS256) a mano con `node:crypto` — el formato es simple
 * (header.payload.firma, todo en base64url) y no vale la pena sumar la
 * dependencia `jsonwebtoken` sólo para esto. Mismo criterio que
 * `servidor/comun/contrasenas.js`.
 *
 * Lo emite y lo verifica el agregador (el Gateway del nodo central,
 * docs/arquitectura-multi-nodo.md): es el único que necesita
 * `JWT_SECRET`. `usuarios` no sabe qué es un JWT.
 */
const CABECERA = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))

function base64url(texto) {
  return Buffer.from(texto).toString('base64url')
}

function firma(datos) {
  return createHmac('sha256', CONFIG.jwt.secreto).update(datos).digest('base64url')
}

/** `payload` + `exp` (segundos desde época) según `ttlSeg`. */
export function firmar(payload, ttlSeg) {
  const cuerpo = base64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeg }))
  return `${CABECERA}.${cuerpo}.${firma(`${CABECERA}.${cuerpo}`)}`
}

/** `null` si falta, está mal formado, la firma no coincide o venció. */
export function verificar(token) {
  if (!token) return null
  const partes = token.split('.')
  if (partes.length !== 3) return null
  const [cabecera, cuerpo, recibida] = partes

  const esperada = firma(`${cabecera}.${cuerpo}`)
  const bufA = Buffer.from(recibida)
  const bufB = Buffer.from(esperada)
  if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) return null

  try {
    const payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'))
    if (typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) return null
    return payload
  } catch {
    return null
  }
}
