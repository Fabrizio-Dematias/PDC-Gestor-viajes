import { LogOut } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Avatar, AvatarFallback } from '@/components/ui/avatar.jsx'
import { buttonVariants } from '@/components/ui/button.jsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx'
import { cn } from 'cn'
import { useAgencia } from '../../api/tenant.js'
import { useSesion } from '../../estado/sesion.js'

/**
 * El isotipo va como SVG inline y no como glifo (◈): U+25C8 no está en
 * todas las fuentes de sistema y en las que falta se dibuja como caja
 * vacía.
 */
function Isotipo() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" className="shrink-0 text-primary">
      <path d="M8 1 15 8 8 15 1 8Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.4 11.6 8 8 11.6 4.4 8Z" fill="currentColor" />
    </svg>
  )
}

const enlaceClase = ({ isActive }) =>
  cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  )

function iniciales(nombre) {
  return (nombre ?? '')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export default function Nav() {
  const agencia = useAgencia()
  const { usuario, estaAutenticado, cerrarSesion } = useSesion()
  const navegar = useNavigate()

  return (
    <header className="sticky top-0 z-10 flex items-center gap-6 border-b bg-card px-4 py-2.5 sm:px-6">
      <NavLink to="/" className="flex flex-none items-center gap-2 font-semibold tracking-tight text-foreground">
        <Isotipo />
        <span>{agencia.nombre}</span>
      </NavLink>

      <nav className="mr-auto flex gap-1">
        <NavLink to="/" end className={enlaceClase}>
          Buscar
        </NavLink>
        {estaAutenticado && (
          <NavLink to="/perfil" className={enlaceClase}>
            Mi perfil
          </NavLink>
        )}
        {usuario?.rol === 'admin' && (
          <NavLink to="/admin" className={enlaceClase}>
            Admin
          </NavLink>
        )}
      </nav>

      {estaAutenticado ? (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'ghost' }), 'gap-2 px-2')}>
            <Avatar size="sm">
              <AvatarFallback>{iniciales(usuario.nombre)}</AvatarFallback>
            </Avatar>
            {usuario.nombre}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wide">
              {usuario.rol}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                cerrarSesion()
                navegar('/')
              }}
            >
              <LogOut /> Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <NavLink to="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Iniciar sesión
        </NavLink>
      )}
    </header>
  )
}
