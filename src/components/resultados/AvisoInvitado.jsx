import { Link } from 'react-router-dom'

/**
 * Nunca bloquea: se busca y se ven resultados sin cuenta (contrato
 * §10). Esto sólo ofrece loguearse, en el lugar donde más sentido tiene
 * — justo después de una búsqueda, como en cualquier sitio de viajes.
 */
export default function AvisoInvitado() {
  return (
    <p className="text-sm text-muted-foreground">
      Estás buscando como invitado.{' '}
      <Link to="/login" className="font-medium text-primary hover:underline">
        Iniciá sesión
      </Link>{' '}
      para guardar tus preferencias y reservar.
    </p>
  )
}
