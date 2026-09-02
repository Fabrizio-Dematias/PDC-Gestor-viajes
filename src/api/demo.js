import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { HAY_BACKEND, URL_API } from './cliente.js'
import { SALUD, useCaos } from './mock/caos.js'
import { IDS_VERTICALES } from '../dominio/verticales.jsx'

/**
 * Interruptor de fallos para la defensa, en un solo lugar.
 *
 * Sin backend cambia el estado del servidor simulado. Con backend hace
 * un PUT al agregador, que se lo reenvía al vertical, y además lee el
 * estado real cada pocos segundos: si alguien apaga un proceso desde
 * otra terminal, el panel se entera solo. El componente es el mismo en
 * los dos casos.
 */
const REFRESCO_MS = 5000

export function useSaludSimulada() {
  const qc = useQueryClient()
  const [caosLocal, setCaosLocal] = useCaos()

  const { data: sistema } = useQuery({
    queryKey: ['salud-sistema'],
    queryFn: () => fetch(`${URL_API}/salud`).then((r) => r.json()),
    enabled: HAY_BACKEND,
    refetchInterval: HAY_BACKEND ? REFRESCO_MS : false,
    retry: false,
  })

  // Un servicio que no contesta al /salud está caído de verdad, no
  // simulado: se muestra igual, porque para el usuario es lo mismo.
  const remoto = Object.fromEntries(
    IDS_VERTICALES.map((id) => {
      const s = sistema?.servicios?.[id]
      if (!s || s.estado === 'unavailable') return [id, SALUD.CAIDO]
      return [id, s.salud_simulada ?? SALUD.OK]
    }),
  )

  const fijar = useCallback(
    async (vertical, estado) => {
      if (HAY_BACKEND) {
        await fetch(`${URL_API}/api/demo/salud/${vertical}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ estado }),
        }).catch(() => {
          // El vertical puede estar apagado de verdad; entonces el
          // interruptor no tiene a quién hablarle y no pasa nada.
        })
        qc.invalidateQueries({ queryKey: ['salud-sistema'] })
      } else {
        setCaosLocal({ ...caosLocal, [vertical]: estado })
      }

      // Sin esto la demostración no se ve: al repetir la misma búsqueda
      // la queryKey es idéntica y React Query serviría el resultado
      // anterior en vez de volver a preguntar.
      qc.invalidateQueries({ queryKey: [vertical] })
    },
    [caosLocal, qc, setCaosLocal],
  )

  return [HAY_BACKEND ? remoto : caosLocal, fijar]
}
