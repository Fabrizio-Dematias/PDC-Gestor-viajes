import { useQuery } from '@tanstack/react-query'
import { useSesion } from '../estado/sesion.js'
import { AGENCIA_ID, cabecerasAuth, HAY_BACKEND, URL_API } from './cliente.js'

/**
 * Branding + verticales habilitados de la agencia (contrato §8).
 * Mismo criterio que `src/api/perfil.js`: con backend pide
 * `/api/tenant/config`, sin backend usa un objeto fijo — los mismos
 * dos que siembra `servidor/usuarios/datos.js`, para que la demo de
 * marca blanca funcione también en modo front-solo.
 */
const AGENCIAS_SIMULADAS = {
  'ag-demo': {
    id: 'ag-demo',
    nombre: 'Gestor de viajes',
    color_primario: '#1565c0',
    descripcion: 'Buscador de vuelos y hospedaje con tolerancia a fallos parciales.',
    verticales_habilitados: ['vuelos', 'hospedaje', 'traslado'],
  },
  'ag-sur': {
    id: 'ag-sur',
    nombre: 'Aventura Sur Viajes',
    color_primario: '#b45309',
    descripcion: 'Marca blanca de ejemplo: mismo sistema, otra agencia, otra configuración.',
    verticales_habilitados: ['vuelos', 'hospedaje'],
  },
}
const AGENCIA_POR_DEFECTO = AGENCIAS_SIMULADAS['ag-demo']

async function obtenerAgencia(agenciaId) {
  if (!HAY_BACKEND) return AGENCIAS_SIMULADAS[agenciaId] ?? AGENCIA_POR_DEFECTO
  const res = await fetch(`${URL_API}/api/tenant/config`, {
    headers: { 'x-agencia-id': agenciaId, ...cabecerasAuth() },
  })
  if (!res.ok) throw new Error(`tenant/config → ${res.status}`)
  return res.json()
}

/**
 * Con sesión, la marca es la de la agencia del usuario logueado, no la
 * del despliegue (`VITE_AGENCIA_ID`) — el agregador ya resuelve esto
 * mismo del lado del servidor (§8: la sesión gana sobre la cabecera),
 * esto es sólo para que el front pida la agencia correcta desde el
 * principio en vez de pedir la del build y corregirse después. Sin
 * sesión (invitado), sigue siendo la del despliegue.
 */
export function useAgencia() {
  const { usuario } = useSesion()
  const agenciaId = usuario?.agencia_id ?? AGENCIA_ID

  const { data } = useQuery({
    queryKey: ['agencia', agenciaId],
    queryFn: () => obtenerAgencia(agenciaId),
    placeholderData: AGENCIAS_SIMULADAS[agenciaId] ?? AGENCIA_POR_DEFECTO,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  return data ?? AGENCIA_POR_DEFECTO
}
