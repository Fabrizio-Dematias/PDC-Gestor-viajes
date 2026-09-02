import { Link } from 'react-router-dom'
import { MOTIVO, textoDeMotivo } from '../../dominio/estados.js'

/**
 * Un vertical que ni siquiera se pidió, porque el usuario lo desactivó
 * en sus preferencias o el admin lo apagó globalmente.
 *
 * Se muestra colapsado, no oculto del todo: si desaparece sin dejar
 * rastro, el usuario no tiene forma de darse cuenta de que se lo está
 * perdiendo ni de dónde se enciende.
 */
export default function SeccionOculta({ vertical, motivo }) {
  const esDelUsuario = motivo === MOTIVO.DESACTIVADO_POR_USUARIO

  return (
    <section className="seccion seccion--oculta" data-vertical={vertical.id}>
      <div className="oculta">
        <span className="oculta__icono" aria-hidden="true">
          {vertical.icono}
        </span>
        <p className="oculta__texto">
          <strong>{vertical.titulo}</strong> — {textoDeMotivo(motivo)}
        </p>
        {esDelUsuario && (
          <Link className="boton boton--fantasma" to="/perfil">
            Cambiar preferencias
          </Link>
        )}
      </div>
    </section>
  )
}
