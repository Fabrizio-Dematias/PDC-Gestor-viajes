import { RotateCcw } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Button } from '@/components/ui/button.jsx'
import { ESTADO } from '../../dominio/estados.js'
import { antiguedad } from '../../dominio/formato.js'
import { useBusquedaVertical } from '../../hooks/useBusquedaVertical.js'
import AvisoNoDisponible from './AvisoNoDisponible.jsx'
import Skeleton from './Skeleton.jsx'

/**
 * Una sección = un vertical. El límite del fallo.
 *
 * Todo lo que puede salir mal con este vertical se resuelve acá adentro:
 * si el servicio se cae, se rompe esta caja y ninguna otra. Es la
 * traducción a componentes del requisito de fallos parciales.
 */
export default function SeccionResultados({ vertical, criterios }) {
  const { id, titulo, icono, fetcher, Lista } = vertical
  const { data, estado, motivo, hayCacheVieja, actualizadoEn, refetch, isFetching } =
    useBusquedaVertical(id, fetcher, criterios)

  return (
    <section className="grid gap-3" data-vertical={id} data-estado={estado}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <span aria-hidden="true">{icono}</span>
          {titulo}
        </h2>
        <Badge
          variant={estado === ESTADO.NO_DISPONIBLE ? 'destructive' : 'outline'}
          className={estado === ESTADO.OK ? 'border-transparent bg-[var(--ok-fondo)] text-[var(--ok)]' : undefined}
        >
          {estado === ESTADO.CARGANDO && 'buscando…'}
          {estado === ESTADO.OK && `${data.length} resultados`}
          {estado === ESTADO.NO_DISPONIBLE && 'no disponible'}
        </Badge>
      </header>

      {estado === ESTADO.CARGANDO && <Skeleton />}

      {estado === ESTADO.OK && (
        <>
          {data.cacheado && (
            <Alert>
              <RotateCcw />
              <AlertTitle>Datos de respaldo del nodo central</AlertTitle>
              <AlertDescription>
                El servicio no respondió a tiempo. Se muestra la última búsqueda buena, de{' '}
                {antiguedad(data.cacheadoEn)}.
              </AlertDescription>
            </Alert>
          )}
          <Lista items={data} criterios={criterios} />
        </>
      )}

      {estado === ESTADO.NO_DISPONIBLE && hayCacheVieja && (
        <>
          <Alert>
            <RotateCcw />
            <AlertTitle>Mostrando resultados guardados</AlertTitle>
            <AlertDescription>
              El servicio no responde ahora. Estos datos son de {antiguedad(actualizadoEn)} y pueden estar
              desactualizados.
            </AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? 'Reintentando…' : 'Reintentar'}
              </Button>
            </AlertAction>
          </Alert>
          <Lista items={data} criterios={criterios} />
        </>
      )}

      {estado === ESTADO.NO_DISPONIBLE && !hayCacheVieja && (
        <AvisoNoDisponible motivo={motivo} onReintentar={() => refetch()} />
      )}
    </section>
  )
}
