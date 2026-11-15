import { useQuery } from '@tanstack/react-query'
import { descartarSesion, useSesion } from '../estado/sesion.js'
import { cabecerasAuth, HAY_BACKEND, URL_API, V1 } from './cliente.js'

/**
 * Los servicios que el registro conoce (Módulo 4) y si pasan su health
 * check. Sólo para administradores: son direcciones internas. Sin
 * backend no hay registro que mirar.
 */
const REFRESCO_MS = 4000

export function useServiciosDelSistema() {
  const { estaAutenticado, usuario } = useSesion()
  const habilitado = HAY_BACKEND && estaAutenticado && usuario?.rol === 'admin'

  const { data, isError, isPending } = useQuery({
    queryKey: ['sistema-servicios'],
    queryFn: async () => {
      const res = await fetch(`${URL_API}${V1}/sistema/servicios`, { headers: cabecerasAuth() })
      if (res.status === 401) descartarSesion() // ver estado/sesion.js
      if (!res.ok) throw new Error(`sistema/servicios → ${res.status}`)
      return res.json()
    },
    enabled: habilitado,
    refetchInterval: REFRESCO_MS,
    retry: false,
  })

  return { habilitado, datos: data, cargando: habilitado && isPending, error: isError }
}

/**
 * Los últimos 50 cambios de configuración de la agencia del
 * administrador (qué vertical se apagó o encendió, qué administrador se
 * creó, qué permisos cambiaron), con quién y cuándo. Lo que el backend
 * registra en la tabla `auditoria` desde la Etapa 3.
 */
export function useAuditoria() {
  const { estaAutenticado, usuario } = useSesion()
  const habilitado = HAY_BACKEND && estaAutenticado && usuario?.rol === 'admin'

  const { data, isError, isPending } = useQuery({
    queryKey: ['auditoria'],
    queryFn: async () => {
      const res = await fetch(`${URL_API}${V1}/admin/auditoria`, { headers: cabecerasAuth() })
      if (res.status === 401) descartarSesion()
      if (!res.ok) throw new Error(`admin/auditoria → ${res.status}`)
      return res.json()
    },
    enabled: habilitado,
    refetchInterval: REFRESCO_MS,
    retry: false,
  })

  return { habilitado, registros: data ?? [], cargando: habilitado && isPending, error: isError }
}
