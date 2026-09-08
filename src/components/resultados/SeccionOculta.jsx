import { Link } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert.jsx'
import { buttonVariants } from '@/components/ui/button.jsx'
import { MOTIVO, textoDeMotivo } from '../../dominio/estados.js'

/**
 * Un vertical que ni siquiera se pidió, porque el usuario lo desactivó
 * en sus preferencias, el admin lo apagó globalmente o esta búsqueda no
 * trae los campos que necesita (contrato §4).
 *
 * Se muestra colapsado, no oculto del todo: si desaparece sin dejar
 * rastro, el usuario no tiene forma de darse cuenta de que se lo está
 * perdiendo ni de dónde se enciende.
 */
export default function SeccionOculta({ vertical, motivo }) {
  const esDelUsuario = motivo === MOTIVO.DESACTIVADO_POR_USUARIO
  const faltanCampos = motivo === MOTIVO.CAMPOS_INSUFICIENTES || motivo === MOTIVO.OTRA_PESTANA

  return (
    <section data-vertical={vertical.id}>
      <Alert>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <span aria-hidden="true">{vertical.icono}</span>{' '}
            <strong className="text-foreground">{vertical.titulo}</strong> — {textoDeMotivo(motivo)}
          </span>
          {esDelUsuario && (
            <Link to="/perfil" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Cambiar preferencias
            </Link>
          )}
          {faltanCampos && (
            <Link to="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Buscar {vertical.titulo.toLowerCase()}
            </Link>
          )}
        </AlertDescription>
      </Alert>
    </section>
  )
}
