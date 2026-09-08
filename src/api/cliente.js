import { leer } from '../estado/almacen.js'
import { MOTIVO } from '../dominio/estados.js'
import { ServicioNoDisponible } from '../dominio/errores.js'
import { pedirMock } from './mock/servidor.js'

/**
 * El único punto del front que sabe cómo se habla con el agregador.
 *
 * Hoy el transporte es el servidor mock en memoria; mañana es `fetch`
 * contra el agregador real. Ese cambio es esta función y nada más:
 * hooks, componentes y páginas no se enteran. Es el mismo patrón de dos
 * implementaciones detrás de una interfaz que usan los verticales con
 * Amadeus (Módulo 4), aplicado un nivel más arriba.
 */

export const URL_API = import.meta.env?.VITE_API_URL
/** Sin `VITE_API_URL` el front corre solo, contra el servidor simulado. */
export const HAY_BACKEND = URL_API !== undefined
const USAR_MOCK = !HAY_BACKEND

/**
 * Con qué agencia arranca este front de marca blanca — se fija en el
 * build (`VITE_AGENCIA_ID`), no en tiempo de ejecución: cada agencia es
 * su propio despliegue del mismo código
 * (docs/arquitectura-multi-nodo.md §2). No es identidad de usuario —
 * eso ahora viaja en el token de sesión (§10), no en una cabecera.
 */
export const AGENCIA_ID = import.meta.env?.VITE_AGENCIA_ID ?? 'ag-demo'

/**
 * `Authorization: Bearer <token>` si hay sesión, o nada. Lee
 * directamente de `localStorage` (vía `leer()`) en vez de por un hook,
 * porque `transporte()` no es un componente — mismo motivo por el que
 * `src/api/mock/caos.js` hace lo mismo con el estado de salud simulado.
 */
export function cabecerasAuth() {
  const sesion = leer('sesion', null)
  return sesion?.token ? { authorization: `Bearer ${sesion.token}` } : {}
}

/**
 * Nodo de agencia local (servidor/nodo-agencia/): recibe la bitácora de
 * búsquedas fire-and-forget de `useBusquedaVertical`. Sin esta
 * variable, no se manda nada — no es un requisito para que el resto del
 * front funcione.
 */
export const URL_NODO_AGENCIA = import.meta.env?.VITE_URL_NODO_AGENCIA

/** Presupuesto front → agregador. Ver contrato §3. */
export const TIMEOUT_MS = 3000

function aQueryString(criterios) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(criterios ?? {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  return p.toString()
}

async function transporte(vertical, criterios, signal) {
  if (USAR_MOCK) return pedirMock(vertical, criterios, { signal })
  const qs = aQueryString(criterios)
  return fetch(`${URL_API}/api/buscar/${vertical}?${qs}`, {
    signal,
    headers: { 'x-agencia-id': AGENCIA_ID, ...cabecerasAuth() },
  })
}

/**
 * Busca un vertical. Resuelve con el array de items, o rechaza con
 * `ServicioNoDisponible`. Nunca deja una promesa colgada: el
 * AbortController garantiza que a los TIMEOUT_MS hay una respuesta,
 * aunque sea un fallo.
 */
export async function buscarVertical(vertical, criterios, { signal } = {}) {
  const control = new AbortController()
  const cortar = setTimeout(
    () => control.abort(new DOMException('timeout', 'TimeoutError')),
    TIMEOUT_MS,
  )
  // Si React Query cancela la query (el usuario cambió de búsqueda),
  // propagamos ese abort al pedido en curso.
  signal?.addEventListener('abort', () => control.abort(signal.reason), {
    once: true,
  })

  try {
    const res = await transporte(vertical, criterios, control.signal)
    const cuerpo = await res.json()

    if (!res.ok) {
      throw new ServicioNoDisponible(vertical, cuerpo?.motivo ?? MOTIVO.ERROR)
    }
    if (!Array.isArray(cuerpo?.items)) {
      // 200 que no cumple el contrato. Es un bug del backend, pero para
      // el usuario el resultado es el mismo: no hay datos que mostrar.
      throw new ServicioNoDisponible(vertical, MOTIVO.ERROR)
    }
    // El "cuarto caso" del contrato §5: el agregador puede responder ok
    // con datos de su caché (Redis) en vez de con la búsqueda fresca.
    // Se marca sobre el propio array —sigue siendo un array normal para
    // todo lo demás— para no tener que tocar la forma que ya esperan
    // `SeccionResultados` y `<Lista items={...}>`. Se guarda el momento
    // absoluto (no la duración) para que quien lo muestre no tenga que
    // llamar a `Date.now()` durante el render.
    if (cuerpo.cacheado) {
      cuerpo.items.cacheado = true
      cuerpo.items.cacheadoEn = Date.now() - cuerpo.edad_ms
    }
    return cuerpo.items
  } catch (error) {
    if (error instanceof ServicioNoDisponible) throw error
    if (error?.name === 'TimeoutError') {
      throw new ServicioNoDisponible(vertical, MOTIVO.TIMEOUT, error)
    }
    if (error?.name === 'AbortError') throw error // cancelación legítima
    throw new ServicioNoDisponible(vertical, MOTIVO.ERROR, error)
  } finally {
    clearTimeout(cortar)
  }
}
