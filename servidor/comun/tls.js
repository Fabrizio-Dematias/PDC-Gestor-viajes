import { readFileSync } from 'node:fs'
import { Agent } from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Cifrado en tránsito entre componentes (TLS), con verificación de
 * identidad en las dos puntas.
 *
 * Cifrar no alcanza contra un *man-in-the-middle*: también hay que
 * comprobar que el otro extremo es quien dice ser. Por eso:
 *
 * - **Una CA propia** (`certs/ca.crt`, la genera `npm run tls:certs`)
 *   firma un certificado por servicio. Nadie confía en un certificado
 *   que no venga de ella: los clientes no apagan la verificación
 *   (`rejectUnauthorized` queda en su valor por defecto, `true`).
 * - **TLS mutuo (mTLS) hacia los servicios internos.** Vuelos,
 *   usuarios, el registro… piden certificado también al *cliente* y
 *   cortan el handshake si no está firmado por la CA. Así, alguien que
 *   llegue a `usuarios:4003` sin pasar por el agregador no puede mandar
 *   un `x-usuario-id` inventado: ni siquiera abre la conexión.
 * - **Los servicios públicos** —el agregador y el nodo de agencia, a los
 *   que les habla el navegador— usan TLS común: el navegador verifica al
 *   servidor y la identidad del usuario la da el JWT.
 *
 * Se activa con `TLS=on`. Apagado (por defecto) todo sigue siendo HTTP,
 * como antes: así un integrante que todavía no generó los certificados
 * puede levantar el sistema igual.
 */

export const TLS_ACTIVO = process.env.TLS === 'on'
export const ESQUEMA = TLS_ACTIVO ? 'https' : 'http'

/** Sólo TLS 1.2 y 1.3: las versiones anteriores están deprecadas. */
const VERSION_MINIMA = 'TLSv1.2'

const DIRECTORIO = process.env.TLS_DIR ?? fileURLToPath(new URL('../../certs/', import.meta.url))

function leer(archivo) {
  try {
    return readFileSync(path.join(DIRECTORIO, archivo))
  } catch {
    throw new Error(`TLS=on pero falta ${archivo} en ${DIRECTORIO}. Generar los certificados con: npm run tls:certs`)
  }
}

/** Certificado, clave y CA de un servicio. */
function credenciales(nombre) {
  return { ca: leer('ca.crt'), cert: leer(`${nombre}.crt`), key: leer(`${nombre}.key`) }
}

/**
 * Quién es este proceso, para presentar su certificado como cliente.
 * Sale de `TLS_IDENTIDAD` o, si no, de la carpeta del servicio que se
 * arrancó (`servidor/vuelos/index.js` → `vuelos`).
 */
const identidad = () => process.env.TLS_IDENTIDAD ?? path.basename(path.dirname(process.argv[1] ?? ''))

/**
 * Opciones de `https.createServer` para un servicio.
 * @param exigirCliente mTLS: sin certificado de cliente firmado por la
 *   CA, la conexión se corta en el handshake.
 */
export function opcionesServidor(nombre, { exigirCliente }) {
  return {
    ...credenciales(nombre),
    requestCert: exigirCliente,
    rejectUnauthorized: exigirCliente,
    minVersion: VERSION_MINIMA,
  }
}

let agente = null

/**
 * Agente para las llamadas salientes entre servicios: confía sólo en la
 * CA propia y presenta el certificado de este proceso. Conexiones
 * keep-alive, así el handshake se paga una vez por conexión y no por
 * pedido.
 */
export function agenteTls() {
  agente ??= new Agent({ keepAlive: true, minVersion: VERSION_MINIMA, ...credenciales(identidad()) })
  return agente
}
