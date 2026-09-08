import { AGENCIA_ID, HAY_BACKEND, URL_API } from './cliente.js'

/**
 * Login real (contrato §10). Sólo funciona con backend conectado: el
 * modo 100% mock (`npm run dev`, sin `VITE_API_URL`) sigue sin
 * autenticación real — simularla completa para un modo que existe para
 * correr el front solo no vale el trabajo.
 */
async function pedir(ruta, cuerpo) {
  if (!HAY_BACKEND) {
    throw new Error('El login necesita el backend conectado (VITE_API_URL).')
  }
  const res = await fetch(`${URL_API}${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agencia-id': AGENCIA_ID },
    body: JSON.stringify(cuerpo),
  })
  const datos = await res.json().catch(() => null)
  if (!res.ok) {
    const error = new Error(datos?.error ?? `${ruta} → ${res.status}`)
    error.motivo = datos?.motivo
    error.estado = res.status
    throw error
  }
  return datos
}

/** `{ ok, email, codigo_demo? }` — `codigo_demo` sólo con el proveedor
 *  de email ficticio (servidor/comun/email.js). */
export const registrarse = ({ email, password, nombre }) =>
  pedir('/api/auth/registro', { email, password, nombre })

/** `{ token, usuario }` — loguea directo, sin pedir la contraseña de nuevo. */
export const verificarEmail = ({ email, codigo }) =>
  pedir('/api/auth/verificar-email', { email, codigo })

export const reenviarCodigo = ({ email }) => pedir('/api/auth/reenviar-codigo', { email })

/** `{ token, usuario }`. `identificador` es un email (clientes) o un
 *  `username` (administradores). */
export const iniciarSesion = ({ identificador, password }) =>
  pedir('/api/auth/login', { identificador, password })
