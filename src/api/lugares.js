import { useQuery } from '@tanstack/react-query'
import { CATALOGO_SIMULADO } from '../dominio/lugares.js'
import { HAY_BACKEND, URL_API } from './cliente.js'

/**
 * Catálogo de aeropuertos y rutas.
 *
 * Con backend lo sirve el servicio de vuelos, que es el dueño del padrón
 * de aeropuertos. Importa que sea el catálogo real y no una lista
 * inventada: de las 36 × 70 combinaciones posibles de origen y destino
 * sólo 255 son rutas que existen, y ofrecer las demás llevaría al
 * usuario a búsquedas vacías.
 *
 * Si el servicio de vuelos está caído, el catálogo no llega y se usa el
 * simulado. Es una degradación más: el buscador sigue en pie.
 */
export function useLugares() {
  const { data } = useQuery({
    queryKey: ['lugares'],
    queryFn: async () => {
      const res = await fetch(`${URL_API}/api/lugares`)
      if (!res.ok) throw new Error(`lugares → ${res.status}`)
      return res.json()
    },
    enabled: HAY_BACKEND,
    placeholderData: CATALOGO_SIMULADO,
    staleTime: Infinity,
    retry: 1,
  })
  return data ?? CATALOGO_SIMULADO
}
