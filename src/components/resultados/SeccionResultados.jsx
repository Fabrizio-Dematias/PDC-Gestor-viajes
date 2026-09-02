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
    <section className="seccion" data-vertical={id} data-estado={estado}>
      <header className="seccion__cabecera">
        <h2 className="seccion__titulo">
          <span className="seccion__icono" aria-hidden="true">
            {icono}
          </span>
          {titulo}
        </h2>
        <span className={`insignia insignia--${estado}`}>
          {estado === ESTADO.CARGANDO && 'buscando…'}
          {estado === ESTADO.OK && `${data.length} resultados`}
          {estado === ESTADO.NO_DISPONIBLE && 'no disponible'}
        </span>
      </header>

      {estado === ESTADO.CARGANDO && <Skeleton />}

      {estado === ESTADO.OK && <Lista items={data} />}

      {estado === ESTADO.NO_DISPONIBLE && hayCacheVieja && (
        <>
          <div className="aviso aviso--cache" role="status">
            <span className="aviso__icono" aria-hidden="true">
              ⟳
            </span>
            <div>
              <p className="aviso__titulo">Mostrando resultados guardados</p>
              <p className="aviso__texto">
                El servicio no responde ahora. Estos datos son de{' '}
                {antiguedad(actualizadoEn)} y pueden estar desactualizados.
              </p>
            </div>
            <button
              type="button"
              className="boton boton--fantasma"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? 'Reintentando…' : 'Reintentar'}
            </button>
          </div>
          <Lista items={data} />
        </>
      )}

      {estado === ESTADO.NO_DISPONIBLE && !hayCacheVieja && (
        <AvisoNoDisponible motivo={motivo} onReintentar={() => refetch()} />
      )}
    </section>
  )
}
