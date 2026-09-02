import { useId, useMemo, useRef, useState } from 'react'
import { buscarAeropuerto, buscarLugares } from '../dominio/lugares.js'

/**
 * Campo de lugar con sugerencias: se escribe una ciudad, un país o un
 * código y aparecen los aeropuertos que coinciden.
 *
 * Reemplaza a un `<select>` porque la lista real tiene 70 aeropuertos en
 * 22 países: desplegarla entera obliga a recorrerla con la vista, y para
 * el destino cambia según el origen. Escribir dos letras es más rápido
 * que buscar en una lista larga.
 *
 * Sólo sugiere aeropuertos que existen en el catálogo, así que no se
 * puede tipear un destino inexistente.
 */
const VISIBLES = 8

export default function BuscadorLugar({
  etiqueta,
  valor,
  catalogo,
  permitidos,
  onElegir,
  placeholder = 'Ciudad, país o código',
}) {
  const idLista = useId()
  const entrada = useRef(null)
  const [borrador, setBorrador] = useState(null) // null = no se está editando
  const [resaltado, setResaltado] = useState(0)

  const editando = borrador !== null
  const elegido = buscarAeropuerto(catalogo, valor)

  const { coincidencias, descartadas } = useMemo(
    () => buscarLugares(catalogo, editando ? borrador : '', permitidos),
    [catalogo, borrador, editando, permitidos],
  )
  const lista = coincidencias.slice(0, VISIBLES)
  const restantes = coincidencias.length - lista.length

  function elegir(aeropuerto) {
    if (!aeropuerto) return
    onElegir(aeropuerto.iata)
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
          value={editando ? borrador : (elegido?.ciudad ?? '')}
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
        {!editando && elegido && <span className="combo__iata">{elegido.iata}</span>}
      </div>

      {editando && (
        <ul className="combo__lista" role="listbox" id={idLista}>
          {lista.length === 0 && (
            <li className="combo__vacio">
              Ningún aeropuerto coincide
              {descartadas > 0 && ' entre los que tienen vuelo directo'}
            </li>
          )}

          {lista.map((a, i) => (
            <li
              key={a.iata}
              id={`${idLista}-${i}`}
              role="option"
              aria-selected={i === resaltado}
              className={`combo__opcion${i === resaltado ? ' combo__opcion--activa' : ''}`}
              // `mousedown` y no `click`: el blur del input llega antes
              // que el click y cerraría la lista sin elegir nada.
              onMouseDown={(e) => {
                e.preventDefault()
                elegir(a)
              }}
              onMouseEnter={() => setResaltado(i)}
            >
              <span className="combo__opcion-texto">
                <span className="combo__ciudad">{a.ciudad}</span>
                <span className="combo__detalle">
                  {a.pais} · {a.nombre}
                </span>
              </span>
              <span className="combo__codigo">{a.iata}</span>
            </li>
          ))}

          {(restantes > 0 || descartadas > 0) && (
            <li className="combo__pie">
              {restantes > 0 && `${restantes} más — seguí escribiendo`}
              {restantes > 0 && descartadas > 0 && ' · '}
              {descartadas > 0 && `${descartadas} sin vuelo directo desde el origen`}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
