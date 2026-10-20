import { useQuery } from '@tanstack/react-query'
import { CATALOGO_SIMULADO, crearCatalogo } from '../dominio/lugares.js'
import { HAY_BACKEND, URL_API, V1 } from './cliente.js'

/**
 * Catálogo de ciudades y aeropuertos.
 *
 * Con backend lo sirve el servicio de vuelos (por el agregador, en
 * `/api/v1/lugares`), que es el dueño del padrón. Son ~5800 ciudades de
 * todo el mundo: el buscador las filtra en el navegador mientras se
 * escribe, así que el catálogo se baja una sola vez (el servidor lo
 * comprime con gzip: de ~900 KB a ~130 KB).
 *
 * Si el servicio de vuelos está caído, el catálogo no llega y se usa el
 * simulado. Es una degradación más: el buscador sigue en pie.
 */
export function useLugares() {
  const { data } = useQuery({
    queryKey: ['lugares', 'v1'],
    queryFn: async () => {
      const res = await fetch(`${URL_API}${V1}/lugares`)
      if (!res.ok) throw new Error(`lugares → ${res.status}`)
      const cuerpo = await res.json()
      if (!Array.isArray(cuerpo?.ciudades)) throw new Error('lugares: respuesta sin ciudades')
      return crearCatalogo(cuerpo.ciudades)
    },
    enabled: HAY_BACKEND,
    placeholderData: CATALOGO_SIMULADO,
    staleTime: Infinity,
    retry: 1,
  })
  return data ?? CATALOGO_SIMULADO
}
