import { formatearPrecio } from '../../dominio/formato.js'

function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function duracion(min) {
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} m`
}

function escalas(n) {
  if (n === 0) return 'Directo'
  return n === 1 ? '1 escala' : `${n} escalas`
}

export default function ListaVuelos({ items }) {
  return (
    <ul className="lista">
      {items.map((v) => (
        <li key={v.id} className="tarjeta tarjeta--vuelo">
          <div className="tarjeta__marca" aria-hidden="true">
            {v.codigo_aerolinea}
          </div>
          <div className="tarjeta__cuerpo">
            <p className="tarjeta__titulo">{v.aerolinea}</p>
            <p className="itinerario">
              <span className="itinerario__hora">{hora(v.salida)}</span>
              <span className="itinerario__iata">{v.origen}</span>
              <span className="itinerario__linea" aria-hidden="true" />
              <span className="itinerario__iata">{v.destino}</span>
              <span className="itinerario__hora">{hora(v.llegada)}</span>
            </p>
            <p className="tarjeta__meta">
              {duracion(v.duracion_min)} · {escalas(v.escalas)}
            </p>
          </div>
          <div className="tarjeta__precio">
            <span className="precio">{formatearPrecio(v.precio)}</span>
            <span className="precio__nota">total</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
