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
 * Fase 3 lo reemplaza por el usuario que salga del token de sesión.
 * Hoy viaja en una cabecera y el backend confía en ella: alcanza para
 * que el agregador sepa de quién son las preferencias, pero no es
 * autenticación.
 */
export const USUARIO_ID = 'u-001'

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
    headers: { 'x-usuario-id': USUARIO_ID },
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
