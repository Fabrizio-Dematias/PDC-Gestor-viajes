import { useQuery } from '@tanstack/react-query'
import { AGENCIA_ID, HAY_BACKEND, URL_API } from './cliente.js'

/**
 * Branding + verticales habilitados de la agencia de este front
 * (contrato §8). Mismo criterio que `src/api/perfil.js`: con backend
 * pide `/api/tenant/config`, sin backend usa un objeto fijo — los
 * mismos dos que siembra `servidor/usuarios/datos.js`, para que la
 * demo de marca blanca funcione también en modo front-solo.
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

async function obtenerAgencia() {
  if (!HAY_BACKEND) return AGENCIAS_SIMULADAS[AGENCIA_ID] ?? AGENCIA_POR_DEFECTO
  const res = await fetch(`${URL_API}/api/tenant/config`, {
    headers: { 'x-agencia-id': AGENCIA_ID },
  })
  if (!res.ok) throw new Error(`tenant/config → ${res.status}`)
  return res.json()
}

export function useAgencia() {
  const { data } = useQuery({
    queryKey: ['agencia', AGENCIA_ID],
    queryFn: obtenerAgencia,
    placeholderData: AGENCIAS_SIMULADAS[AGENCIA_ID] ?? AGENCIA_POR_DEFECTO,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  return data ?? AGENCIA_POR_DEFECTO
}
