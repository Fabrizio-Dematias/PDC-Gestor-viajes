import { VERTICALES } from '../../dominio/verticales.jsx'

/**
 * Capa automática de preferencias: el usuario dice qué le interesa y el
 * agregador deja de pedir el resto.
 *
 * Vale la pena notar por qué está acá y no sólo en "opciones": reduce la
 * superficie de fallo que ese usuario puede llegar a ver. Personalización
 * y resiliencia terminan siendo el mismo mecanismo.
 */
export default function EncuestaPreferencias({ preferencias, onCambiar }) {
  return (
    <fieldset className="encuesta">
      <legend className="encuesta__leyenda">¿Qué querés que busquemos?</legend>
      {VERTICALES.map((v) => (
        <label key={v.id} className="opcion">
          <input
            type="checkbox"
            checked={Boolean(preferencias[v.id])}
            onChange={(e) => onCambiar(v.id, e.target.checked)}
          />
          <span className="opcion__icono" aria-hidden="true">
            {v.icono}
          </span>
          <span className="opcion__cuerpo">
            <span className="opcion__titulo">{v.titulo}</span>
            <span className="opcion__desc">{v.descripcionPreferencia}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
