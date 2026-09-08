import { MOTIVO } from '../../dominio/estados.js'
import { generarHospedaje } from './datos/hospedaje.js'
import { generarTraslado } from './datos/traslado.js'
import { generarVuelos } from './datos/vuelos.js'
import { SALUD, saludDe } from './caos.js'

/**
 * Stand-in en memoria del agregador. Cumple el contrato de
 * docs/contrato-agregador.md §1 y nada más: devuelve el mismo cuerpo
 * JSON que va a devolver el backend real, incluyendo los 503.
 *
 * No conoce React. La única forma de hablarle es `pedir()`, igual que
 * con un servidor de verdad.
 */

const GENERADORES = {
  vuelos: generarVuelos,
  hospedaje: generarHospedaje,
  traslado: generarTraslado,
}

const LATENCIA = {
  [SALUD.OK]: () => 300 + Math.random() * 600,
  [SALUD.LENTO]: () => 1800,
  [SALUD.CAIDO]: () => 120,
}

/** `setTimeout` que respeta el AbortSignal en vez de ignorarlo. */
function esperar(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const id = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/** Una respuesta con la forma que tiene `fetch`, para poder cambiar el
 *  transporte sin tocar al cliente. */
function respuesta(status, cuerpo) {
  return { ok: status < 400, status, json: async () => cuerpo }
}

export async function pedirMock(vertical, criterios, { signal } = {}) {
  const salud = saludDe(vertical)

  // Colgado: la conexión queda abierta para siempre. Sólo la corta el
  // AbortController del cliente. Este es el caso que justifica el
  // timeout: sin él, la búsqueda entera espera indefinidamente.
  if (salud === SALUD.COLGADO) {
    await new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      })
    })
  }

  await esperar(LATENCIA[salud](), signal)

  if (salud === SALUD.CAIDO) {
    return respuesta(503, {
      vertical,
      estado: 'unavailable',
      motivo: MOTIVO.ERROR,
      generado_en: new Date().toISOString(),
    })
  }

  const generar = GENERADORES[vertical]
  if (!generar) return respuesta(404, { error: `vertical desconocido: ${vertical}` })

  return respuesta(200, {
    vertical,
    estado: 'ok',
    generado_en: new Date().toISOString(),
    items: generar(criterios),
  })
}
