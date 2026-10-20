import { Plane } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { buscarLugar, buscarLugares } from '../dominio/lugares.js'

/**
 * Campo de lugar con sugerencias: se escribe una ciudad, un país, un
 * aeropuerto o un código y aparecen las ciudades que coinciden.
 *
 * Reemplaza a un `<select>` porque la lista real tiene ~5800 ciudades:
 * desplegarla entera obliga a recorrerla con la vista. Escribir dos
 * letras es más rápido que buscar en una lista larga.
 *
 * Se elige una **ciudad** ("Buenos Aires", que en vuelos busca en todos
 * sus aeropuertos) o, cuando la ciudad tiene varios, un aeropuerto en
 * particular (Ezeiza, Aeroparque). Sólo sugiere lugares que existen en
 * el catálogo, así que no se puede tipear un destino inexistente.
 *
 * `soloVuelos` es para la pestaña de vuelos: deja afuera lo que no tiene
 * servicio aéreo y ofrece los aeropuertos de cada ciudad. Hospedaje y
 * traslado eligen ciudades, sin aeropuertos.
 */
const VISIBLES = 9

export default function BuscadorLugar({
  etiqueta,
  valor,
  catalogo,
  soloVuelos = false,
  onElegir,
  placeholder = 'Ciudad, país o código',
}) {
  const idLista = useId()
  const entrada = useRef(null)
  const [borrador, setBorrador] = useState(null) // null = no se está editando
  const [resaltado, setResaltado] = useState(0)

  const editando = borrador !== null
  const elegido = buscarLugar(catalogo, valor)

  const { coincidencias, descartadas } = useMemo(
    () => buscarLugares(catalogo, editando ? borrador : '', { soloVuelos }),
    [catalogo, borrador, editando, soloVuelos],
  )

  // Se corta por filas pero sin partir un grupo a la mitad: una ciudad
  // sin sus aeropuertos confunde más que ayudar.
  const lista = useMemo(() => {
    if (coincidencias.length <= VISIBLES) return coincidencias
    let corte = VISIBLES
    while (corte < coincidencias.length && coincidencias[corte].tipo === 'aeropuerto') corte++
    return coincidencias.slice(0, corte)
  }, [coincidencias])
  const restantes = coincidencias.length - lista.length

  /** Lo que se ve en el campo cuando no se está escribiendo. */
  const textoElegido = elegido
    ? elegido.tipo === 'aeropuerto' && elegido.ciudad.aeropuertos.filter((a) => a.vuelos).length > 1
      ? `${elegido.ciudad.nombre} · ${elegido.aeropuerto.nombre}`
      : elegido.ciudad.nombre
    : ''

  function elegir(opcion) {
    if (!opcion) return
    onElegir(opcion.codigo)
    setBorrador(null)
    setResaltado(0)
    entrada.current?.blur()
  }

  function alTeclear(e) {
    if (!editando && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setBorrador('')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setResaltado((i) => Math.min(i + 1, lista.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltado((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && editando) {
      // Sin esto, Enter enviaría el formulario con el valor viejo.
      e.preventDefault()
      elegir(lista[resaltado])
    } else if (e.key === 'Escape') {
      setBorrador(null)
      setResaltado(0)
    }
  }

  return (
    <div className="campo combo">
      <span className="campo__etiqueta" id={`${idLista}-et`}>
        {etiqueta}
      </span>

      <div className="combo__campo">
        <input
          ref={entrada}
          type="text"
          role="combobox"
          aria-expanded={editando}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-labelledby={`${idLista}-et`}
          aria-activedescendant={editando && lista[resaltado] ? `${idLista}-${resaltado}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={editando ? borrador : textoElegido}
          onChange={(e) => {
            setBorrador(e.target.value)
            setResaltado(0)
          }}
          onFocus={() => setBorrador('')}
          onBlur={() => {
            setBorrador(null)
            setResaltado(0)
          }}
          onKeyDown={alTeclear}
        />
        {!editando && elegido && <span className="combo__iata">{valor}</span>}
      </div>

      {editando && (
        <ul className="combo__lista" role="listbox" id={idLista}>
          {borrador === '' && lista.length > 0 && <li className="combo__titulo">Más buscados</li>}

          {lista.length === 0 && (
            <li className="combo__vacio">
              Ningún lugar coincide
              {descartadas > 0 && ' entre los que tienen vuelos'}
            </li>
          )}

          {lista.map((o, i) => {
            const esAeropuerto = o.tipo === 'aeropuerto'
            const varios = !esAeropuerto && soloVuelos && o.aeropuertos.length > 1
            return (
              <li
                key={`${o.tipo}-${o.codigo}`}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={i === resaltado}
                className={`combo__opcion${esAeropuerto ? ' combo__opcion--aeropuerto' : ''}${i === resaltado ? ' combo__opcion--activa' : ''}`}
                // `mousedown` y no `click`: el blur del input llega antes
                // que el click y cerraría la lista sin elegir nada.
                onMouseDown={(e) => {
                  e.preventDefault()
                  elegir(o)
                }}
                onMouseEnter={() => setResaltado(i)}
              >
                <span className="combo__opcion-texto">
                  <span className="combo__ciudad">
                    {esAeropuerto && <Plane aria-hidden="true" className="combo__avion" />}
                    {esAeropuerto ? o.aeropuerto.nombre : o.ciudad.nombre}
                  </span>
                  <span className="combo__detalle">
                    {esAeropuerto
                      ? `Aeropuerto · ${o.ciudad.nombre}`
                      : varios
                        ? `${o.ciudad.pais} · Todos los aeropuertos (${o.aeropuertos.length})`
                        : soloVuelos
                          ? `${o.ciudad.pais} · ${o.aeropuertos[0]?.nombre ?? ''}`
                          : o.ciudad.pais}
                  </span>
                </span>
                <span className="combo__codigo">{o.codigo}</span>
              </li>
            )
          })}

          {(restantes > 0 || descartadas > 0) && (
            <li className="combo__pie">
              {restantes > 0 && `${restantes} más — seguí escribiendo`}
              {restantes > 0 && descartadas > 0 && ' · '}
              {descartadas > 0 && `${descartadas} ${descartadas === 1 ? 'coincidencia sin vuelos' : 'coincidencias sin vuelos'}`}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
