import { useState } from 'react'
import { useSaludSimulada } from '../../api/demo.js'
import { DESCRIPCION_SALUD, SALUD } from '../../api/mock/caos.js'
import { VERTICALES } from '../../dominio/verticales.jsx'

/**
 * Panel de la defensa. Reemplaza al `docker stop` mientras el backend no
 * exista, y cubre un caso que apagar un contenedor *no* reproduce: el
 * servicio colgado, que acepta la conexión y nunca contesta. Ese es el
 * que distingue un sistema con timeouts de uno que se cuelga entero.
 *
 * Vive en `components/demo/` a propósito: cuando el backend esté en
 * contenedores, esta carpeta se borra de una y nada más se rompe.
 */
const ORDEN = [SALUD.OK, SALUD.LENTO, SALUD.CAIDO, SALUD.COLGADO]

const ETIQUETAS = {
  [SALUD.OK]: 'OK',
  [SALUD.LENTO]: 'Lento',
  [SALUD.CAIDO]: 'Caído',
  [SALUD.COLGADO]: 'Colgado',
}

export default function PanelFallos() {
  const [abierto, setAbierto] = useState(false)
  const [caos, fijarSalud] = useSaludSimulada()

  const rotos = VERTICALES.filter((v) => (caos[v.id] ?? SALUD.OK) !== SALUD.OK)

  return (
    <div className={`panel-fallos${abierto ? ' panel-fallos--abierto' : ''}`}>
      <button
        type="button"
        className="panel-fallos__tirador"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
      >
        <span className="panel-fallos__punto" data-roto={rotos.length > 0} />
        Simular fallos
        {rotos.length > 0 && (
          <span className="panel-fallos__contador">{rotos.length}</span>
        )}
      </button>

      {abierto && (
        <div className="panel-fallos__cuerpo">
          <p className="panel-fallos__intro">
            Cambiá el estado de un servicio y volvé a buscar. El resto de la
            pantalla tiene que seguir funcionando.
          </p>

          {VERTICALES.map((v) => {
            const actual = caos[v.id] ?? SALUD.OK
            return (
              <div key={v.id} className="panel-fallos__vertical">
                <p className="panel-fallos__nombre">
                  <span aria-hidden="true">{v.icono}</span> {v.titulo}
                </p>
                <div className="segmentado" role="group" aria-label={v.titulo}>
                  {ORDEN.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="segmentado__opcion"
                      aria-pressed={actual === s}
                      onClick={() => fijarSalud(v.id, s)}
                    >
                      {ETIQUETAS[s]}
                    </button>
                  ))}
                </div>
                <p className="panel-fallos__desc">{DESCRIPCION_SALUD[actual]}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
