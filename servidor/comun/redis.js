import { createClient } from 'redis'
import { CONFIG } from './config.js'

/**
 * Redis del nodo central: los dos mecanismos de la Etapa 5 que hoy pasan
 * a vivir acá en vez de en memoria del agregador — circuit breaker y
 * caché de última respuesta buena (docs/contrato-agregador.md §5,
 * "cuarto caso"). Un solo cliente, conectado de forma perezosa: si
 * Redis no está arriba, `conectar()` falla y quien lo llama decide qué
 * hacer (el agregador no debe caerse por esto — ver `agregador/index.js`).
 */
const cliente = createClient({ url: CONFIG.redis.url })
cliente.on('error', (error) => console.error('[redis] error de conexión:', error.message))

let conectando = null
async function conectar() {
  if (cliente.isOpen) return cliente
  conectando ??= cliente.connect()
  await conectando
  return cliente
}

const claveCache = (agenciaId, vertical) => `cache:${agenciaId}:${vertical}`
const claveFallos = (agenciaId, vertical) => `breaker:fallos:${agenciaId}:${vertical}`
const claveAbierto = (agenciaId, vertical) => `breaker:abierto:${agenciaId}:${vertical}`

/** Guarda la última respuesta buena de un vertical, por agencia. */
export async function cacheGuardar(agenciaId, vertical, items) {
  const c = await conectar()
  const valor = JSON.stringify({ items, generado_en: Date.now() })
  await c.set(claveCache(agenciaId, vertical), valor, { PX: CONFIG.cache.ttlMs })
}

/** `null` si no hay caché vigente; si no, los items y su antigüedad. */
export async function cacheLeer(agenciaId, vertical) {
  const c = await conectar()
  const crudo = await c.get(claveCache(agenciaId, vertical))
  if (!crudo) return null
  const { items, generado_en } = JSON.parse(crudo)
  return { items, edadMs: Date.now() - generado_en }
}

/** ¿El circuito está abierto para este vertical, en esta agencia? */
export async function breakerAbierto(agenciaId, vertical) {
  const c = await conectar()
  return (await c.exists(claveAbierto(agenciaId, vertical))) === 1
}

/**
 * Un fallo más. Si se llega al umbral dentro de la ventana, abre el
 * circuito por `breaker.abiertoMs` — durante ese tiempo no se vuelve a
 * llamar al vertical, así se deja de pagar el timeout completo en cada
 * búsqueda mientras el servicio está caído (docs/entrega-0... mecanismo 4).
 */
export async function breakerRegistrarFallo(agenciaId, vertical) {
  const c = await conectar()
  const clave = claveFallos(agenciaId, vertical)
  const fallos = await c.incr(clave)
  if (fallos === 1) await c.pExpire(clave, CONFIG.breaker.ventanaFalloMs)
  if (fallos >= CONFIG.breaker.fallosParaAbrir) {
    await c.set(claveAbierto(agenciaId, vertical), '1', { PX: CONFIG.breaker.abiertoMs })
    console.warn(`[breaker] ${vertical}/${agenciaId} → circuito abierto (${fallos} fallos seguidos)`)
  }
}

/** Un éxito resetea el contador de fallos — vuelve a empezar la ventana. */
export async function breakerRegistrarExito(agenciaId, vertical) {
  const c = await conectar()
  await c.del(claveFallos(agenciaId, vertical))
}
