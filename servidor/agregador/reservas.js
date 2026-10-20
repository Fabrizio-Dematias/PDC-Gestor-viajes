import { CONFIG } from '../comun/config.js'
import { conFailover, urlServicio } from '../comun/descubrimiento.js'
import { conEstado, ErrorHttp } from '../comun/http.js'
import { pedirJson } from '../comun/pedir.js'
import { publicarEvento } from '../comun/redis.js'

/**
 * Reservas en el agregador: los dos canales de comunicación del
 * proyecto en un solo flujo (Módulo 3).
 *
 *   front ──POST /reservas──▶ agregador ──POST /reservas──▶ vuelos      SÍNCRONO
 *                                 │                            │        (espera la respuesta)
 *                                 │◀───────── 201 + código ────┘
 *                                 │
 *                                 └──XADD reserva_confirmada──▶ Redis    ASÍNCRONO
 *                                                                 │      (no espera a nadie)
 *                                                    notificaciones ◀────┘
 *
 * ## Qué es síncrono y por qué
 *
 * La reserva. El usuario está mirando la pantalla y necesita saber *en
 * ese momento* si consiguió el asiento: confirmada, sin cupo, o error.
 * El agregador llama a vuelos y espera, con un timeout (2,5 s) cortado
 * por `AbortController`.
 *
 * Con un timeout no se sabe si la reserva se hizo o no: puede que vuelos
 * la haya confirmado y la respuesta se haya perdido. Por eso el cliente
 * manda siempre una `Idempotency-Key` y, ante un 503, **reintenta con la
 * misma**: si ya existía, vuelos devuelve la misma reserva sin descontar
 * otro asiento. "Al menos una vez" desde el cliente + idempotencia en el
 * servidor = efecto de una sola vez.
 *
 * ## Qué es asíncrono y por qué
 *
 * El aviso de confirmación. No tiene que frenar la reserva ni hacerla
 * fallar, y el servicio que lo manda puede estar caído. El agregador
 * sólo espera que Redis reciba el evento (XADD), no que alguien lo
 * procese.
 *
 * Si Redis está caído, la reserva **igual se confirma** y la respuesta
 * lo dice (`evento_encolado: false`): perder el aviso es mejor que
 * perder la reserva. Limitación conocida: ese aviso no se reintenta solo
 * (sí si el cliente repite el pedido con la misma clave, que vuelve a
 * publicar); una versión más robusta guardaría el evento junto con la
 * reserva (patrón *outbox*).
 */

const ENCABEZADO_CLAVE = 'idempotency-key'

/** El evento no puede ser más que lo mínimo que necesita el consumidor:
 *  sin documentos ni datos de los pasajeros. */
function eventoDe(reserva) {
  return {
    tipo: 'reserva_confirmada',
    reserva_id: reserva.reserva_id,
    codigo: reserva.codigo,
    email: reserva.email,
    pasajeros: String(reserva.pasajeros),
    repetida: String(Boolean(reserva.repetida)),
    publicado_en: new Date().toISOString(),
  }
}

/** `true` si Redis recibió el evento. Nunca lanza: el aviso es secundario. */
async function publicar(reserva) {
  try {
    await publicarEvento(eventoDe(reserva))
    return true
  } catch (error) {
    console.warn(`[agregador] no se pudo encolar el aviso de la reserva ${reserva.reserva_id} (${error.message})`)
    return false
  }
}

export async function reservar({ cuerpo, headers, usuarioId }) {
  const clave = String(headers[ENCABEZADO_CLAVE] ?? '').trim()
  if (!clave) {
    throw new ErrorHttp(400, {
      error: 'falta la cabecera Idempotency-Key',
      motivo: 'sin_idempotency_key',
    })
  }

  let respuesta
  try {
    // Si la instancia de vuelos no se puede conectar se prueba con otra:
    // es seguro porque el pedido lleva su Idempotency-Key.
    respuesta = await conFailover('vuelos', (base) =>
      pedirJson(`${base}/api/reservas`, {
        metodo: 'POST',
        cuerpo: { ...cuerpo, usuario_id: usuarioId },
        headers: { [ENCABEZADO_CLAVE]: clave },
        timeoutMs: CONFIG.timeouts.vertical,
      }),
    )
  } catch (error) {
    // No se sabe si vuelos llegó a reservar: lo único seguro es
    // reintentar con la misma clave.
    throw new ErrorHttp(503, {
      error: 'el servicio de vuelos no respondió',
      motivo: error?.motivo === 'timeout' ? 'timeout' : 'error',
      reintentable: true,
      nota: 'Reintentá con la misma Idempotency-Key: si la reserva ya se hizo, se devuelve la misma.',
    })
  }

  const { ok, estado, datos } = respuesta
  if (!ok) {
    // 4xx (sin cupo, vuelo desconocido, pedido inválido): vuelos
    // respondió, y esa respuesta es la que importa. 5xx: falló.
    if (estado >= 400 && estado < 500) return conEstado(estado, datos)
    throw new ErrorHttp(503, {
      error: 'el servicio de vuelos devolvió un error',
      motivo: datos?.motivo ?? 'error',
      reintentable: true,
    })
  }

  // Canal asíncrono: se publica y se sigue. También en las repeticiones
  // (200): si el primer intento publicó pero el cliente nunca vio la
  // respuesta, este vuelve a intentarlo; el consumidor descarta el
  // duplicado por `reserva_id`.
  const eventoEncolado = await publicar(datos)
  return conEstado(estado, { ...datos, evento_encolado: eventoEncolado })
}

/** La reserva más el estado de su aviso. Si notificaciones no responde,
 *  eso no impide ver la reserva: sólo se dice que el estado no se sabe. */
export async function leerReserva(reservaId) {
  let respuesta
  try {
    respuesta = await pedirJson(`${urlServicio('vuelos')}/api/reservas/${encodeURIComponent(reservaId)}`, {
      timeoutMs: CONFIG.timeouts.vertical,
    })
  } catch (error) {
    throw new ErrorHttp(503, { error: 'el servicio de vuelos no respondió', motivo: error?.motivo ?? 'error' })
  }
  if (!respuesta.ok) return conEstado(respuesta.estado, respuesta.datos)

  let notificacion = { estado: 'no_disponible' }
  try {
    const n = await pedirJson(
      `${urlServicio('notificaciones')}/api/notificaciones/${encodeURIComponent(reservaId)}`,
      { timeoutMs: 800 },
    )
    notificacion = n.ok ? { estado: 'enviada', enviada_en: n.datos.enviada_en } : { estado: 'pendiente' }
  } catch {
    // notificaciones caído: el aviso espera en la cola.
    notificacion = { estado: 'no_disponible' }
  }
  return { ...respuesta.datos, notificacion }
}
