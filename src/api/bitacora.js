import { URL_NODO_AGENCIA } from './cliente.js'

/**
 * Bitácora del nodo de agencia (servidor/nodo-agencia/,
 * docs/arquitectura-multi-nodo.md §4): *fire-and-forget*, nunca puede
 * retrasar ni romper una búsqueda. La llama `useBusquedaVertical`
 * después de que cada vertical resuelve, sin `await` en el camino
 * crítico.
 *
 * Sin `VITE_URL_NODO_AGENCIA` (modo front-solo, o un front que no tiene
 * nodo de agencia propio) no hace nada — no es un requisito para que el
 * resto del sistema funcione.
 */
export function registrarBusqueda({ vertical, estado, motivo, criterios }) {
  if (!URL_NODO_AGENCIA) return
  fetch(`${URL_NODO_AGENCIA}/api/registro`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      vertical,
      estado,
      motivo,
      criterios,
      buscado_en: new Date().toISOString(),
    }),
  }).catch(() => {
    // El nodo de agencia local tampoco responde: no hay nada que hacer
    // acá, y no es motivo para que la búsqueda del usuario falle.
  })
}
