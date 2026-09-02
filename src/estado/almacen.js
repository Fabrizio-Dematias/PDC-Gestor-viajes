import { useCallback, useSyncExternalStore } from 'react'

/**
 * Persistencia local mínima, con suscripción para que todos los
 * componentes que leen una clave se reenteren al escribirla.
 *
 * Fase 0–1: preferencias, config de admin y sesión viven acá. Cuando
 * existan los endpoints del contrato (§1) esto pasa a ser sólo caché
 * optimista del servidor.
 */
const PREFIJO = 'gv:'
const oyentes = new Set()

function notificar() {
  for (const fn of oyentes) fn()
}

const cache = new Map()

/** Otra pestaña escribió: el valor cacheado acá quedó viejo. */
function alCambiarOtraPestana(evento) {
  if (evento.key?.startsWith(PREFIJO)) {
    cache.delete(evento.key.slice(PREFIJO.length))
    notificar()
  }
}

function suscribir(fn) {
  oyentes.add(fn)
  if (oyentes.size === 1) {
    window.addEventListener('storage', alCambiarOtraPestana)
  }
  return () => {
    oyentes.delete(fn)
    if (oyentes.size === 0) {
      window.removeEventListener('storage', alCambiarOtraPestana)
    }
  }
}

export function leer(clave, porDefecto) {
  if (cache.has(clave)) return cache.get(clave)
  let valor = porDefecto
  try {
    const crudo = localStorage.getItem(PREFIJO + clave)
    if (crudo !== null) valor = JSON.parse(crudo)
  } catch {
    // localStorage bloqueado o JSON corrupto: seguimos con el default.
  }
  cache.set(clave, valor)
  return valor
}

export function escribir(clave, valor) {
  cache.set(clave, valor)
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify(valor))
  } catch {
    // Sin persistencia, pero la sesión en curso sigue funcionando.
  }
  notificar()
}

/** `useState` que sobrevive al reload y se comparte entre componentes. */
export function useAlmacen(clave, porDefecto) {
  const valor = useSyncExternalStore(
    suscribir,
    () => leer(clave, porDefecto),
    () => porDefecto,
  )
  const setValor = useCallback(
    (siguiente) => {
      const actual = leer(clave, porDefecto)
      escribir(
        clave,
        typeof siguiente === 'function' ? siguiente(actual) : siguiente,
      )
    },
    [clave, porDefecto],
  )
  return [valor, setValor]
}
