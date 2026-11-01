import { conEstado } from '../comun/http.js'

/**
 * Límite de intentos fallidos para el login y la verificación de email.
 *
 * Sin esto, una contraseña se puede adivinar probando sin parar, y el
 * código de verificación (6 dígitos, vale 15 minutos) se puede recorrer
 * entero: un millón de pedidos alcanzan. Con `MAXIMO` fallos seguidos
 * para la misma cuenta, esa cuenta queda bloqueada `VENTANA_MS` y el
 * agregador responde 429 sin llamar siquiera a usuarios.
 *
 * Se cuenta por cuenta (email o usuario), no por IP: el atacante puede
 * cambiar de IP, pero no de víctima. El costo es que alguien puede
 * bloquear a propósito la cuenta de otro por 15 minutos; se acepta
 * porque es temporal y no expone nada.
 *
 * Vive en la memoria del agregador: con una sola instancia alcanza. Con
 * varias, cada una contaría por su lado y habría que moverlo a Redis.
 */
const MAXIMO = 5
const VENTANA_MS = 15 * 60_000

/** clave → { fallos, desde } */
const fallos = new Map()

const vigente = (registro) => registro && Date.now() - registro.desde < VENTANA_MS

/**
 * Corre `intentar` salvo que la cuenta esté bloqueada, y cuenta el
 * resultado: un 401 o un 400 (credenciales o código inválidos) suma un
 * fallo; un éxito lo borra.
 */
export async function conLimiteDeIntentos(clave, intentar) {
  const cuenta = String(clave ?? '').trim().toLowerCase()
  const registro = fallos.get(cuenta)
  if (vigente(registro) && registro.fallos >= MAXIMO) {
    const segundos = Math.ceil((registro.desde + VENTANA_MS - Date.now()) / 1000)
    return conEstado(
      429,
      { error: 'demasiados intentos fallidos; probá de nuevo más tarde', motivo: 'demasiados_intentos' },
      { 'retry-after': String(segundos) },
    )
  }

  const salida = await intentar()
  const estado = salida?.estado
  if (estado === 401 || estado === 400) {
    const actual = vigente(registro) ? registro : { fallos: 0, desde: Date.now() }
    actual.fallos += 1
    fallos.set(cuenta, actual)
  } else if (!estado || estado < 300) {
    fallos.delete(cuenta)
  }
  return salida
}

// Limpieza de los registros vencidos, para que el mapa no crezca sin fin.
setInterval(() => {
  for (const [cuenta, registro] of fallos) if (!vigente(registro)) fallos.delete(cuenta)
}, VENTANA_MS).unref()
