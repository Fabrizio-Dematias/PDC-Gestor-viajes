import { AGENCIA_ID, cabecerasAuth, HAY_BACKEND, URL_API, V1 } from './cliente.js'

/**
 * Reservas (Módulo 3). Con backend, el front habla con el agregador
 * (`POST /api/v1/reservas`), que a su vez llama a vuelos y espera la
 * respuesta; sin backend, devuelve una reserva simulada para que el
 * flujo se pueda recorrer igual.
 *
 * ## La clave de idempotencia
 *
 * Cada reserva viaja con una `Idempotency-Key` que el front genera **una
 * vez** al llegar a la pantalla de datos y reusa en cada reintento. Si
 * la respuesta se pierde (timeout, corte de red) no se sabe si la
 * reserva se hizo; reenviar con la misma clave es seguro: si ya
 * existía, el servidor devuelve la misma sin descontar otro asiento.
 * Sin esto, un doble clic o un reintento reservaría dos veces.
 */

/** Presupuesto front → agregador para reservar. El agregador corta a
 *  vuelos a los 2,5 s; esto es un poco más para que se vea su respuesta
 *  antes que el corte propio. */
const TIMEOUT_RESERVA_MS = 4500

export class ErrorReserva extends Error {
  constructor(motivo, mensaje, detalle) {
    super(mensaje)
    this.name = 'ErrorReserva'
    /** 'sin_cupo' | 'vuelo_no_reservable' | 'solicitud_invalida' | 'no_disponible' */
    this.motivo = motivo
    this.detalle = detalle
    /** ¿Tiene sentido volver a intentar con la misma clave? */
    this.reintentable = motivo === 'no_disponible'
  }
}

export function nuevaClave() {
  return globalThis.crypto?.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function codigoAlAzar() {
  const alfabeto = 'ABCDEF0123456789'
  return Array.from({ length: 6 }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join('')
}

/**
 * @param vuelos los vuelos elegidos (uno por tramo)
 * @param contacto `{ email, telefono }`
 * @param nombres nombres de los pasajeros (los documentos no viajan)
 */
export async function reservar({ vuelos, pasajeros, contacto, nombres, clave }) {
  if (!HAY_BACKEND) {
    await new Promise((r) => setTimeout(r, 400))
    return {
      reserva_id: clave,
      codigo: codigoAlAzar(),
      estado: 'confirmada',
      vuelos: vuelos.map((v) => v.id),
      pasajeros,
      email: contacto?.email,
      repetida: false,
      simulada: true,
    }
  }

  const control = new AbortController()
  const cortar = setTimeout(() => control.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_RESERVA_MS)
  let res
  try {
    res = await fetch(`${URL_API}${V1}/reservas`, {
      method: 'POST',
      signal: control.signal,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': clave,
        'x-agencia-id': AGENCIA_ID,
        ...cabecerasAuth(),
      },
      body: JSON.stringify({
        vuelos: vuelos.map((v) => v.id),
        pasajeros,
        contacto: { email: contacto?.email },
        nombres,
      }),
    })
  } catch (error) {
    throw new ErrorReserva(
      'no_disponible',
      error?.name === 'TimeoutError'
        ? 'La confirmación tardó demasiado. Es posible que la reserva se haya hecho: reintentá y, si ya existe, la recuperamos sin cobrarte dos veces.'
        : 'No pudimos comunicarnos con el servidor para confirmar la reserva.',
    )
  } finally {
    clearTimeout(cortar)
  }

  const datos = await res.json().catch(() => null)
  if (res.ok) return datos

  if (res.status === 409) {
    throw new ErrorReserva(
      'sin_cupo',
      datos?.libres > 0
        ? `Quedan sólo ${datos.libres} ${datos.libres === 1 ? 'asiento' : 'asientos'} en uno de los vuelos y elegiste más.`
        : 'Se agotaron los asientos de uno de los vuelos mientras reservabas.',
      datos,
    )
  }
  if (res.status === 404) {
    throw new ErrorReserva(
      'vuelo_no_reservable',
      'Este vuelo viene de un proveedor externo y no se puede reservar en esta demostración. Elegí otro.',
      datos,
    )
  }
  if (res.status >= 500) {
    throw new ErrorReserva(
      'no_disponible',
      datos?.motivo === 'timeout'
        ? 'El servicio de vuelos no respondió a tiempo. Reintentá: no se reserva dos veces.'
        : 'El servicio de reservas no está disponible ahora. Reintentá en unos segundos.',
      datos,
    )
  }
  throw new ErrorReserva('solicitud_invalida', datos?.error ?? 'La reserva no es válida.', datos)
}

/** La reserva y el estado de su aviso de confirmación (el canal
 *  asíncrono): `notificacion.estado` ∈ enviada | pendiente | no_disponible. */
export async function leerReserva(id) {
  if (!HAY_BACKEND) return null
  const res = await fetch(`${URL_API}${V1}/reservas/${encodeURIComponent(id)}`, { headers: { 'x-agencia-id': AGENCIA_ID } })
  if (!res.ok) return null
  return res.json()
}
