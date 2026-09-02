import { useState } from 'react'
import { useLugares } from '../api/lugares.js'
import { CRITERIOS_INICIALES } from '../dominio/criterios.js'
import BuscadorLugar from './BuscadorLugar.jsx'

export default function BuscadorViajes({ valores = CRITERIOS_INICIALES, onBuscar, compacto }) {
  const [form, setForm] = useState(valores)
  const catalogo = useLugares()

  const destinos = catalogo.rutas[form.origen] ?? []
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

  return (
    <form
      className={`buscador${compacto ? ' buscador--compacto' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        onBuscar(form)
      }}
    >
      <BuscadorLugar
        etiqueta="Origen"
        valor={form.origen}
        catalogo={catalogo}
        permitidos={catalogo.origenes}
        onElegir={cambiarOrigen}
        placeholder="¿Desde dónde salís?"
      />

      <BuscadorLugar
        etiqueta="Destino"
        valor={form.destino}
        catalogo={catalogo}
        permitidos={destinos}
        onElegir={(iata) => setForm((f) => ({ ...f, destino: iata }))}
        placeholder="¿A dónde vas?"
      />

      <label className="campo">
        <span className="campo__etiqueta">Ida</span>
        <input type="date" value={form.ida} onChange={cambiar('ida')} required />
      </label>

      <label className="campo">
        <span className="campo__etiqueta">Vuelta</span>
        <input
          type="date"
          value={form.vuelta}
          min={form.ida}
          onChange={cambiar('vuelta')}
        />
      </label>

      <label className="campo">
        <span className="campo__etiqueta">Pasajeros</span>
        <input
          type="number"
          min="1"
          max="9"
          value={form.pasajeros}
          onChange={cambiar('pasajeros')}
        />
      </label>

      <button type="submit" className="boton boton--primario" disabled={faltaDestino}>
        Buscar
      </button>
    </form>
  )
}
