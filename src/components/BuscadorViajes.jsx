import { Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Checkbox } from '@/components/ui/checkbox.jsx'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { useLugares } from '../api/lugares.js'
import { CRITERIOS_INICIALES } from '../dominio/criterios.js'
import { codificarTramos, decodificarTramos, tramoVacio, tramosCompletos } from '../dominio/tramos.js'
import { VERTICALES, verticalPorId } from '../dominio/verticales.jsx'
import BuscadorLugar from './BuscadorLugar.jsx'
import OcupacionSelector from './OcupacionSelector.jsx'

const TIPOS_VIAJE = [
  { id: 'ida_vuelta', etiqueta: 'Ida y vuelta' },
  { id: 'solo_ida', etiqueta: 'Solo ida' },
  { id: 'multidestino', etiqueta: 'Multidestino' },
]
const MAX_TRAMOS = 4

/** La solapa con la que arranca. Si `valores` ya trae qué vertical se
 *  pidió (viene de un resultado, no de un formulario en blanco) se usa
 *  ese directo — si no, la primera cuyos campos ya están completos, para
 *  links viejos armados antes de que `vertical` viajara en la URL. Sin
 *  esto, reabrir una búsqueda de Traslado mostraría la solapa Hospedaje
 *  activa: los dos piden los mismos campos, y Hospedaje va primero. */
function inferirPestana(valores) {
  if (valores.vertical && verticalPorId(valores.vertical)) return valores.vertical
  const conTodo = VERTICALES.find((v) => v.camposBusqueda.every((c) => valores[c]))
  return conTodo?.id ?? VERTICALES[0].id
}

/** Ida y vuelta / solo ida / multidestino — se infiere de qué trae
 *  `valores`, para que reabrir un resultado reabra en el mismo modo. */
function inferirTipoViaje(valores) {
  if (decodificarTramos(valores)) return 'multidestino'
  if (valores.ida && !valores.vuelta) return 'solo_ida'
  return 'ida_vuelta'
}

/**
 * Un formulario, tres solapas (contrato §4): elegir Vuelos, Hospedaje o
 * Traslado no dispara tres búsquedas distintas — sigue siendo una sola,
 * en `/resultados`, con las secciones en paralelo de siempre — pero
 * decide qué campos tienen sentido pedir. Antes de esto, la única
 * solapa era "buscar" y los tres verticales recibían los mismos
 * criterios, aunque `hospedaje` y `traslado` ni usan `origen`.
 *
 * Vuelos y traslado suman un segundo eje, el tipo de viaje — pero cada
 * uno a su manera, porque no son el mismo problema (contrato §4-bis):
 * un vuelo puede tener escalas de verdad en distintas ciudades
 * (multidestino, una lista abierta de tramos); un traslado como mucho
 * se toma dos veces —recogida y regreso— y a lo sumo cambia el lugar
 * de una de las dos, no la cantidad de tramos. Por eso traslado no
 * usa la lista de `multidestino`: usa ida/vuelta con hora y un
 * checkbox para "devolver en otro lugar", el mismo molde que un
 * alquiler de auto.
 */
export default function BuscadorViajes({ valores = CRITERIOS_INICIALES, onBuscar, compacto, onPestanaChange }) {
  const [form, setForm] = useState(valores)
  const [pestana, setPestana] = useState(() => inferirPestana(valores))

  // Le avisa al que lo usa qué solapa está activa — Home.jsx lo usa
  // para mostrar contenido distinto según qué se está buscando. No es
  // el mismo dato que `onBuscar`: este cambia con cada click de
  // solapa, `onBuscar` sólo al enviar el formulario.
  useEffect(() => {
    onPestanaChange?.(pestana)
  }, [pestana, onPestanaChange])
  const [tipoViaje, setTipoViaje] = useState(() => inferirTipoViaje(valores))
  const [tramos, setTramos] = useState(() => decodificarTramos(valores) ?? [tramoVacio(), tramoVacio()])
  const [otroLugarVuelta, setOtroLugarVuelta] = useState(() => Boolean(valores.destino_vuelta))
  const catalogo = useLugares()

  const vertical = verticalPorId(pestana)
  const mostrarOrigen = vertical.camposBusqueda.includes('origen')
  const enMultidestino = vertical.soportaMultidestino && tipoViaje === 'multidestino'
  const mostrarTipoViaje = vertical.soportaMultidestino || vertical.usaHora
  const mostrarVuelta = vertical.usaVuelta && tipoViaje !== 'solo_ida' && !enMultidestino
  const mostrarOtroLugar = vertical.permiteVueltaOtroLugar && mostrarVuelta

  // Sin origen (hospedaje, traslado) cualquier aeropuerto del catálogo
  // es un destino válido — sólo vuelos limita el destino a los que
  // tienen ruta real desde el origen elegido.
  const destinosPermitidos = mostrarOrigen ? (catalogo.rutas[form.origen] ?? []) : undefined
  const faltaDestino = enMultidestino
    ? !tramosCompletos(tramos, vertical.tramoConOrigen)
    : !form.destino || (mostrarOtroLugar && otroLugarVuelta && !form.destino_vuelta)

  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }))

  const cambiarTramo = (i, campo, valor) =>
    setTramos((ts) => ts.map((t, idx) => (idx === i ? { ...t, [campo]: valor } : t)))

  const agregarTramo = () =>
    setTramos((ts) => (ts.length >= MAX_TRAMOS ? ts : [...ts, tramoVacio()]))

  const quitarTramo = (i) =>
    setTramos((ts) => (ts.length <= 2 ? ts : ts.filter((_, idx) => idx !== i)))

  function elegirTipoViaje(id) {
    setTipoViaje(id)
    if (id !== 'ida_vuelta') setOtroLugarVuelta(false)
    // Al entrar a multidestino por primera vez, el primer tramo arranca
    // con lo que ya se había cargado en el formulario simple — así no
    // se pierde lo que el usuario ya había elegido.
    if (id === 'multidestino' && tramos.every((t) => !t.destino)) {
      setTramos([{ origen: form.origen, destino: form.destino, fecha: form.ida }, tramoVacio()])
    }
  }

  /**
   * Al cambiar el origen, un destino que ya no se vuela desde ahí se
   * borra en vez de reemplazarse por otro: elegir un destino por el
   * usuario, sin avisarle, es peor que dejarle el campo vacío.
   */
  const cambiarOrigen = (iata) =>
    setForm((f) => ({
      ...f,
      origen: iata,
      destino: (catalogo.rutas[iata] ?? []).includes(f.destino) ? f.destino : '',
    }))

  function enviar(e) {
    e.preventDefault()
    if (enMultidestino) {
      onBuscar({
        ...codificarTramos(tramos),
        pasajeros: form.pasajeros,
        vertical: vertical.id,
      })
      return
    }
    // Ocupación (hospedaje): lo que el contrato entiende sigue siendo
    // `pasajeros` — adultos + niños —, así que se deriva acá; adultos,
    // niños y habitaciones viajan igual, sólo para poder reabrir la
    // búsqueda con el selector en el mismo estado (§4-bis).
    const adultos = Number(form.adultos ?? 1)
    const ninos = Number(form.ninos ?? 0)

    // Los campos que esta solapa no usa no viajan en la búsqueda —
    // aunque hayan quedado cargados de una solapa anterior — para que
    // `Resultados.jsx` no crea que sí se pidieron (§4).
    onBuscar({
      ...form,
      origen: mostrarOrigen ? form.origen : '',
      vuelta: mostrarVuelta ? form.vuelta : '',
      hora_ida: vertical.usaHora ? (form.hora_ida ?? '') : '',
      hora_vuelta: vertical.usaHora && mostrarVuelta ? (form.hora_vuelta ?? '') : '',
      destino_vuelta: mostrarOtroLugar && otroLugarVuelta ? form.destino_vuelta : '',
      pasajeros: vertical.usaOcupacion ? adultos + ninos : form.pasajeros,
      adultos: vertical.usaOcupacion ? adultos : '',
      ninos: vertical.usaOcupacion ? ninos : '',
      habitaciones: vertical.usaOcupacion ? Number(form.habitaciones ?? 1) : '',
      // Qué solapa se usó — Resultados.jsx lo usa para mostrar sólo lo
      // que se pidió, no todo lo que la búsqueda alcanzaría a cubrir.
      vertical: vertical.id,
    })
  }

  return (
    // `min-w-0`: como grid item de `.hero` (portada) este div hereda el
    // `min-width:auto` por defecto — con varios campos en fila, la
    // columna implícita de la grilla crecía para no achicarlo por
    // debajo de esa fila sin envolver, y se salía del contenedor en vez
    // de dejar que el buscador envuelva sus campos.
    <div className="min-w-0">
      <Tabs
        value={pestana}
        onValueChange={(v) => {
          setPestana(v)
          setTipoViaje(inferirTipoViaje(valores.vertical === v ? valores : {}))
          setOtroLugarVuelta(false)
        }}
        className="mb-3"
      >
        <TabsList aria-label="Qué buscar">
          {VERTICALES.map((v) => (
            <TabsTrigger key={v.id} value={v.id}>
              <span aria-hidden="true">{v.icono}</span> {v.titulo}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {mostrarTipoViaje && (
        <div className="segmentado segmentado--tipo-viaje" role="group" aria-label="Tipo de viaje">
          {TIPOS_VIAJE.filter((t) => t.id !== 'multidestino' || vertical.soportaMultidestino).map((t) => (
            <button
              key={t.id}
              type="button"
              className="segmentado__opcion"
              aria-pressed={tipoViaje === t.id}
              onClick={() => elegirTipoViaje(t.id)}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>
      )}

      {mostrarOtroLugar && (
        <label className="checkbox-linea">
          <Checkbox
            checked={otroLugarVuelta}
            onCheckedChange={(v) => setOtroLugarVuelta(Boolean(v))}
          />
          Devolver en otro lugar
        </label>
      )}

      <form
        className={`buscador${compacto ? ' buscador--compacto' : ''}${enMultidestino ? ' buscador--tramos' : ''}`}
        onSubmit={enviar}
      >
        {enMultidestino ? (
          <div className="tramos">
            {tramos.map((t, i) => {
              const destinosTramo = vertical.tramoConOrigen ? (catalogo.rutas[t.origen] ?? []) : undefined
              return (
                <div className="tramo" key={i}>
                  <span className="tramo__numero">{vertical.etiquetaTramo} {i + 1}</span>
                  <div className="tramo__campos">
                    {vertical.tramoConOrigen && (
                      <BuscadorLugar
                        etiqueta="Origen"
                        valor={t.origen}
                        catalogo={catalogo}
                        permitidos={catalogo.origenes}
                        onElegir={(iata) => {
                          cambiarTramo(i, 'origen', iata)
                          if (!(catalogo.rutas[iata] ?? []).includes(t.destino)) cambiarTramo(i, 'destino', '')
                        }}
                        placeholder="¿Desde dónde salís?"
                      />
                    )}
                    <BuscadorLugar
                      etiqueta="Destino"
                      valor={t.destino}
                      catalogo={catalogo}
                      permitidos={destinosTramo}
                      onElegir={(iata) => cambiarTramo(i, 'destino', iata)}
                      placeholder={vertical.placeholderDestino}
                    />
                    <label className="campo">
                      <span className="campo__etiqueta">Fecha</span>
                      <input
                        type="date"
                        value={t.fecha}
                        onChange={(e) => cambiarTramo(i, 'fecha', e.target.value)}
                        required
                      />
                    </label>
                  </div>
                  {tramos.length > 2 && (
                    <button
                      type="button"
                      className="tramo__quitar"
                      onClick={() => quitarTramo(i)}
                      aria-label={`Quitar ${vertical.etiquetaTramo.toLowerCase()} ${i + 1}`}
                    >
                      <X aria-hidden="true" />
                    </button>
                  )}
                </div>
              )
            })}

            <div className="tramos__pie">
              {tramos.length < MAX_TRAMOS && (
                <button type="button" className="tramos__agregar" onClick={agregarTramo}>
                  <Plus aria-hidden="true" /> Agregar {vertical.etiquetaTramo.toLowerCase()}
                </button>
              )}
              <label className="campo campo--angosto">
                <span className="campo__etiqueta">Pasajeros</span>
                <input
                  type="number"
                  min="1"
                  max="9"
                  value={form.pasajeros}
                  onChange={cambiar('pasajeros')}
                />
              </label>
              <Button type="submit" disabled={faltaDestino}>
                Buscar
              </Button>
            </div>
          </div>
        ) : (
          <>
            {mostrarOrigen && (
              <BuscadorLugar
                etiqueta="Origen"
                valor={form.origen}
                catalogo={catalogo}
                permitidos={catalogo.origenes}
                onElegir={cambiarOrigen}
                placeholder="¿Desde dónde salís?"
              />
            )}

            <BuscadorLugar
              etiqueta="Destino"
              valor={form.destino}
              catalogo={catalogo}
              permitidos={destinosPermitidos}
              onElegir={(iata) => setForm((f) => ({ ...f, destino: iata }))}
              placeholder={vertical.placeholderDestino}
            />

            <label className="campo">
              <span className="campo__etiqueta">{vertical.etiquetaIda}</span>
              <input type="date" value={form.ida} onChange={cambiar('ida')} required />
            </label>

            {vertical.usaHora && (
              <label className="campo campo--angosto">
                <span className="campo__etiqueta">Hora</span>
                <input type="time" value={form.hora_ida ?? ''} onChange={cambiar('hora_ida')} />
              </label>
            )}

            {mostrarVuelta && (
              <label className="campo">
                <span className="campo__etiqueta">{vertical.etiquetaVuelta ?? 'Vuelta'}</span>
                <input
                  type="date"
                  value={form.vuelta}
                  min={form.ida}
                  onChange={cambiar('vuelta')}
                />
              </label>
            )}

            {mostrarVuelta && vertical.usaHora && (
              <label className="campo campo--angosto">
                <span className="campo__etiqueta">Hora</span>
                <input type="time" value={form.hora_vuelta ?? ''} onChange={cambiar('hora_vuelta')} />
              </label>
            )}

            {mostrarOtroLugar && otroLugarVuelta && (
              <BuscadorLugar
                etiqueta="Lugar de devolución"
                valor={form.destino_vuelta}
                catalogo={catalogo}
                onElegir={(iata) => setForm((f) => ({ ...f, destino_vuelta: iata }))}
                placeholder="¿Dónde te dejamos?"
              />
            )}

            {vertical.usaOcupacion ? (
              <OcupacionSelector
                valor={{ adultos: form.adultos, ninos: form.ninos, habitaciones: form.habitaciones }}
                onCambiar={(o) => setForm((f) => ({ ...f, ...o }))}
              />
            ) : (
              <label className="campo campo--angosto">
                <span className="campo__etiqueta">Pasajeros</span>
                <input
                  type="number"
                  min="1"
                  max="9"
                  value={form.pasajeros}
                  onChange={cambiar('pasajeros')}
                />
              </label>
            )}

            <Button type="submit" disabled={faltaDestino}>
              Buscar
            </Button>
          </>
        )}
      </form>
    </div>
  )
}
