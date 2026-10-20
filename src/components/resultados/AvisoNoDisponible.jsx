import { CircleAlert } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx'
import { Button } from '@/components/ui/button.jsx'
import { MOTIVO, textoDeMotivo } from '../../dominio/estados.js'

/**
 * El aviso que ve el usuario cuando un vertical está `unavailable`.
 *
 * Es el mismo componente para un servicio caído, uno colgado, uno con el
 * circuito abierto y uno apagado por el admin: cambia el `motivo`, no la
 * pantalla. Decisión de diseño del contrato (§5), no una casualidad de
 * implementación.
 *
 * Lo importante para la evaluación: esto vive *dentro* de la sección. El
 * resto de la búsqueda sigue en pie alrededor.
 */
/** El servicio respondió bien pero la búsqueda no tiene sentido: no hay
 *  nada que reintentar, hay que cambiarla. */
const BUSQUEDA_INVALIDA = new Set([MOTIVO.MISMO_LUGAR, MOTIVO.LUGAR_DESCONOCIDO, MOTIVO.SOLICITUD_INVALIDA])

export default function AvisoNoDisponible({ motivo, onReintentar }) {
  const invalida = BUSQUEDA_INVALIDA.has(motivo)
  const reintentable =
    !invalida && motivo !== MOTIVO.APAGADO_POR_ADMIN && motivo !== MOTIVO.DESACTIVADO_POR_USUARIO

  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{invalida ? 'No pudimos armar esta búsqueda' : 'Esta sección no está disponible'}</AlertTitle>
      <AlertDescription>
        <p>{textoDeMotivo(motivo)}</p>
        {!invalida && <p>El resto de tu búsqueda no se vio afectado.</p>}
      </AlertDescription>
      {reintentable && onReintentar && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onReintentar}>
            Reintentar
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}
