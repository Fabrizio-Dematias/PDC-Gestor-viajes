import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Hash de contraseñas con `node:crypto` — sin `bcrypt` ni ninguna otra
 * dependencia, mismo criterio que el resto del backend (node:http,
 * node:sqlite). `scrypt` ya viene en Node y está pensado exactamente
 * para esto (lento a propósito, resistente a fuerza bruta por hardware).
 *
 * Se guarda como `sal:hash`, los dos en hexadecimal, en un solo campo
 * de texto (`usuarios.password_hash`).
 */
const LARGO_HASH = 64

export function hashear(password) {
  const sal = randomBytes(16).toString('hex')
  const hash = scryptSync(password, sal, LARGO_HASH).toString('hex')
  return `${sal}:${hash}`
}

export function verificar(password, guardado) {
  if (!guardado) return false
  const [sal, hash] = guardado.split(':')
  if (!sal || !hash) return false
  const esperado = Buffer.from(hash, 'hex')
  const calculado = scryptSync(password, sal, LARGO_HASH)
  // Largos distintos → nunca son iguales, pero timingSafeEqual tira si
  // los buffers no miden lo mismo: se chequea antes para no romper acá
  // en vez de devolver `false` como cualquier otra contraseña mala.
  if (calculado.length !== esperado.length) return false
  return timingSafeEqual(calculado, esperado)
}
