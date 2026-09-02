import { VERTICALES } from '../../dominio/verticales.jsx'

export default function PanelAdmin({ config, onToggle, agregadas }) {
  return (
    <>
      <section className="bloque">
        <h2>Disponibilidad por servicio</h2>
        <p className="nota">
          Apagar un servicio acá lo saca de las búsquedas de todos los
          usuarios. El agregador deja de llamarlo; el usuario ve la misma
          sección de "no disponible" que vería si el servicio se cayera
          solo.
        </p>
        <ul className="lista-toggles">
          {VERTICALES.map((v) => {
            const activo = config[v.id]?.estado !== 'inactivo'
            return (
              <li key={v.id} className="toggle-fila">
                <span className="toggle-fila__icono" aria-hidden="true">
                  {v.icono}
                </span>
                <span className="toggle-fila__titulo">{v.titulo}</span>
                <span className={`insignia insignia--${activo ? 'ok' : 'unavailable'}`}>
                  {activo ? 'activo' : 'inactivo'}
                </span>
                <button
                  type="button"
                  className="boton boton--fantasma"
                  onClick={() => onToggle(v.id, activo ? 'inactivo' : 'activo')}
                >
                  {activo ? 'Desactivar' : 'Activar'}
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="bloque">
        <h2>Preferencias de los usuarios</h2>
        <p className="nota">
          Cuántos de los {agregadas.total_usuarios} usuarios registrados
          quieren ver cada servicio.
        </p>
        <ul className="medidores">
          {VERTICALES.map((v) => {
            const n = agregadas[v.id] ?? 0
            const pct = agregadas.total_usuarios
              ? Math.round((n / agregadas.total_usuarios) * 100)
              : 0
            return (
              <li key={v.id} className="medidor">
                <span className="medidor__etiqueta">{v.titulo}</span>
                <span className="medidor__pista">
                  <span className="medidor__relleno" style={{ inlineSize: `${pct}%` }} />
                </span>
                <span className="medidor__valor">
                  {n} <span className="medidor__pct">({pct}%)</span>
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
