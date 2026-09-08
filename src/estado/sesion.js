import { useCallback } from 'react'
import { useAlmacen } from './almacen.js'

/**
 * Sesión del usuario (contrato §10): `{ token, usuario }` o `null` si es
 * invitado. Vive en `localStorage` con el mismo mecanismo que el resto
 * del estado del front (`estado/almacen.js`) — nada nuevo que aprender,
 * sólo una clave más.
 */
const CLAVE = 'sesion'

export function useSesion() {
  const [sesion, fijarSesion] = useAlmacen(CLAVE, null)

  const guardarSesion = useCallback(
    (token, usuario) => fijarSesion({ token, usuario }),
    [fijarSesion],
  )

  /** Para que `Nav` muestre el nombre nuevo apenas se edita el perfil,
   *  sin esperar a la próxima vez que se loguee. */
  const actualizarUsuario = useCallback(
    (parcial) => fijarSesion((actual) => (actual ? { ...actual, usuario: { ...actual.usuario, ...parcial } } : actual)),
    [fijarSesion],
  )

  const cerrarSesion = useCallback(() => fijarSesion(null), [fijarSesion])

  return {
    usuario: sesion?.usuario ?? null,
    token: sesion?.token ?? null,
    estaAutenticado: Boolean(sesion?.token),
    guardarSesion,
    actualizarUsuario,
    cerrarSesion,
  }
}
