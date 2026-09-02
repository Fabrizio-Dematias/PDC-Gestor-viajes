import { NavLink } from 'react-router-dom'
import { usePerfil } from '../../api/perfil.js'

/**
 * El isotipo va como SVG inline y no como glifo (◈): U+25C8 no está en
 * todas las fuentes de sistema y en las que falta se dibuja como caja
 * vacía.
 */
function Isotipo() {
  return (
    <svg className="marca__icono" viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
      <path d="M8 1 15 8 8 15 1 8Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.4 11.6 8 8 11.6 4.4 8Z" fill="currentColor" />
    </svg>
  )
}

export default function Nav() {
  const [perfil] = usePerfil()

  return (
    <header className="barra">
      <NavLink to="/" className="marca">
        <Isotipo />
        <span>Gestor de viajes</span>
      </NavLink>

      <nav className="barra__nav">
        <NavLink to="/">Buscar</NavLink>
        <NavLink to="/perfil">Mi perfil</NavLink>
        {perfil.rol === 'admin' && <NavLink to="/admin">Admin</NavLink>}
      </nav>

      <span className="barra__usuario">
        {perfil.nombre}
        <span className="barra__rol">{perfil.rol}</span>
      </span>
    </header>
  )
}
