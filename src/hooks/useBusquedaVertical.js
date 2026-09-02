import { useQuery } from '@tanstack/react-query'
import { ESTADO, MOTIVO } from '../dominio/estados.js'
import { esNoDisponible } from '../dominio/errores.js'

/**
 * El único lugar donde vive el modelo de tres estados del contrato (§5).
 *
 * Cada vertical es una query independiente: React Query las dispara en
 * paralelo y ninguna espera a la otra. Que vuelos aparezca mientras
 * hospedaje sigue cargando no requiere código — es consecuencia de haber
 * separado las queries en vez de hacer una sola llamada combinada.
 */
export function useBusquedaVertical(vertical, fetcherFn, criterios) {
  const query = useQuery({
    queryKey: [vertical, criterios],
    queryFn: ({ signal }) => fetcherFn(criterios, { signal }),
    enabled: Boolean(criterios?.destino),
    retry: (intentos, error) => {
      // Un timeout se reintenta una vez: puede haber sido un pico. Un
      // 503 no: el servicio ya dijo que no puede, insistir sólo suma
      // espera para el usuario.
      if (esNoDisponible(error) && error.motivo === MOTIVO.TIMEOUT) {
        return intentos < 1
      }
      return false
    },
    // Sin backoff exponencial: el reintento es para un pico puntual, y
    // esperar un segundo extra sólo alarga la pantalla en blanco.
    retryDelay: 200,
    // Si el servicio se cae, esto mantiene en memoria la última
    // respuesta buena y la sección puede mostrarla con su antigüedad
    // en vez de quedar vacía.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })

  const hayCacheVieja = query.isError && Array.isArray(query.data)

  return {
    ...query,
    estado: query.isPending
      ? ESTADO.CARGANDO
      : query.isError
        ? ESTADO.NO_DISPONIBLE
        : ESTADO.OK,
    motivo: esNoDisponible(query.error) ? query.error.motivo : undefined,
    hayCacheVieja,
    actualizadoEn: query.dataUpdatedAt,
  }
}
