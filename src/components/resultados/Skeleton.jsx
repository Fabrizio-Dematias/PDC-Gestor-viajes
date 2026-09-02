export default function Skeleton({ filas = 4 }) {
  return (
    <ul className="lista lista--esqueleto" aria-hidden="true">
      {Array.from({ length: filas }, (_, i) => (
        <li key={i} className="tarjeta tarjeta--esqueleto">
          <div className="hueso hueso--cuadro" />
          <div className="tarjeta__cuerpo">
            <div className="hueso hueso--titulo" />
            <div className="hueso hueso--linea" />
            <div className="hueso hueso--corta" />
          </div>
          <div className="hueso hueso--precio" />
        </li>
      ))}
    </ul>
  )
}
