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
export default function AvisoNoDisponible({ motivo, onReintentar }) {
  const reintentable =
    motivo !== MOTIVO.APAGADO_POR_ADMIN &&
    motivo !== MOTIVO.DESACTIVADO_POR_USUARIO

  return (
    <div className="aviso" role="status">
      <span className="aviso__icono" aria-hidden="true">
        !
      </span>
      <div>
        <p className="aviso__titulo">Esta sección no está disponible</p>
        <p className="aviso__texto">{textoDeMotivo(motivo)}</p>
        <p className="aviso__texto aviso__texto--tenue">
          El resto de tu búsqueda no se vio afectado.
        </p>
      </div>
      {reintentable && onReintentar && (
        <button type="button" className="boton boton--fantasma" onClick={onReintentar}>
          Reintentar
        </button>
      )}
    </div>
  )
}
