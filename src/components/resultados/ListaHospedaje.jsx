import { formatearPrecio } from '../../dominio/formato.js'

export default function ListaHospedaje({ items }) {
  return (
    <ul className="lista">
      {items.map((h) => (
        <li key={h.id} className="tarjeta tarjeta--hotel">
          <div className="tarjeta__puntaje" aria-label={`Puntaje ${h.puntaje}`}>
            {h.puntaje.toFixed(1)}
          </div>
          <div className="tarjeta__cuerpo">
            <p className="tarjeta__titulo">{h.nombre}</p>
            <p className="tarjeta__meta">
              {'★'.repeat(h.estrellas)}
              <span className="sr-only">{h.estrellas} estrellas</span> ·{' '}
              {h.ciudad} · {h.opiniones.toLocaleString('es-AR')} opiniones
            </p>
            <ul className="fichas">
              {h.servicios.map((s) => (
                <li key={s} className="ficha">
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="tarjeta__precio">
            <span className="precio">{formatearPrecio(h.precio)}</span>
            <span className="precio__nota">{h.noches} noches</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
