import { useState } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { useLugares } from '../api/lugares.js'
import { CRITERIOS_INICIALES } from '../dominio/criterios.js'
import { VERTICALES, verticalPorId } from '../dominio/verticales.jsx'
import BuscadorLugar from './BuscadorLugar.jsx'

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

/**
 * Un formulario, tres solapas (contrato §4): elegir Vuelos, Hospedaje o
 * Traslado no dispara tres búsquedas distintas — sigue siendo una sola,
 * en `/resultados`, con las secciones en paralelo de siempre — pero
 * decide qué campos tienen sentido pedir. Antes de esto, la única
 * solapa era "buscar" y los tres verticales recibían los mismos
 * criterios, aunque `hospedaje` y `traslado` ni usan `origen`.
 */
export default function BuscadorViajes({ valores = CRITERIOS_INICIALES, onBuscar, compacto }) {
  const [form, setForm] = useState(valores)
  const [pestana, setPestana] = useState(() => inferirPestana(valores))
  const catalogo = useLugares()

  const vertical = verticalPorId(pestana)
  const mostrarOrigen = vertical.camposBusqueda.includes('origen')

  // Sin origen (hospedaje, traslado) cualquier aeropuerto del catálogo
  // es un destino válido — sólo vuelos limita el destino a los que
  // tienen ruta real desde el origen elegido.
  const destinosPermitidos = mostrarOrigen ? (catalogo.rutas[form.origen] ?? []) : undefined
  const faltaDestino = !form.destino

  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }))

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
    // Los campos que esta solapa no usa no viajan en la búsqueda —
    // aunque hayan quedado cargados de una solapa anterior — para que
    // `Resultados.jsx` no crea que sí se pidieron (§4).
    onBuscar({
      ...form,
      origen: mostrarOrigen ? form.origen : '',
      vuelta: vertical.usaVuelta ? form.vuelta : '',
      // Qué solapa se usó — Resultados.jsx lo usa para mostrar sólo lo
      // que se pidió, no todo lo que la búsqueda alcanzaría a cubrir.
      vertical: vertical.id,
    })
  }

  return (
    <div>
      <Tabs value={pestana} onValueChange={setPestana} className="mb-3">
        <TabsList aria-label="Qué buscar">
          {VERTICALES.map((v) => (
            <TabsTrigger key={v.id} value={v.id}>
              <span aria-hidden="true">{v.icono}</span> {v.titulo}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <form
        className={`buscador${compacto ? ' buscador--compacto' : ''}`}
        onSubmit={enviar}
      >
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

        {vertical.usaVuelta && (
          <label className="campo">
            <span className="campo__etiqueta">Vuelta</span>
            <input
              type="date"
              value={form.vuelta}
              min={form.ida}
              onChange={cambiar('vuelta')}
            />
          </label>
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
      </form>
    </div>
  )
}
