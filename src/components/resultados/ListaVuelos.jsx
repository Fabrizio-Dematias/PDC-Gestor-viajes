import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { useLugares } from '../../api/lugares.js'
import { etiquetaDe } from '../../dominio/lugares.js'
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

function escalasTexto(n) {
  if (n === 0) return 'Directo'
  return n === 1 ? '1 escala' : `${n} escalas`
}

const ORDENES = [
  { id: 'precio_asc', etiqueta: 'Más económico' },
  { id: 'precio_desc', etiqueta: 'Más caro' },
  { id: 'duracion_asc', etiqueta: 'Más corto' },
  { id: 'duracion_desc', etiqueta: 'Más largo' },
]

const COMPARADORES = {
  precio_asc: (a, b) => a.precio.monto - b.precio.monto,
  precio_desc: (a, b) => b.precio.monto - a.precio.monto,
  duracion_asc: (a, b) => a.duracion_min - b.duracion_min,
  duracion_desc: (a, b) => b.duracion_min - a.duracion_min,
}

const ETIQUETAS_ESCALAS = {
  todas: 'Cualquier número de escalas',
  directo: 'Sólo directos',
  1: 'Hasta 1 escala',
}

// A diferencia de Radix, el `Select.Value` de Base UI no adivina solo
// la etiqueta del ítem elegido — hay que decirle cómo, con esta función
// de mapeo (ver node_modules/@base-ui/react/select/value/SelectValue.d.ts).
// Sin esto, muestra el `value` crudo ("precio_asc") en vez del texto.
const etiquetaDeOrden = (id) => ORDENES.find((o) => o.id === id)?.etiqueta ?? id

/**
 * Resultados de vuelos con el mismo molde de un motor de venta real
 * (barra de filtros a la izquierda, tarjetas a la derecha, "Seleccionar"
 * abre la comparación de tarifas): ordenar, filtrar por escalas y por
 * aerolínea son enteramente del lado del front, sobre los mismos
 * `items` que ya trajo la búsqueda — no disparan una consulta nueva.
 */
export default function ListaVuelos({ items, criterios }) {
  const [orden, setOrden] = useState('precio_asc')
  const [escalas, setEscalas] = useState('todas')
  const [aerolinea, setAerolinea] = useState('todas')
  const navegar = useNavigate()
  const catalogo = useLugares()

  const aerolineas = useMemo(
    () => [...new Map(items.map((v) => [v.codigo_aerolinea, v.aerolinea])).entries()],
    [items],
  )

  const visibles = useMemo(() => {
    const filtrados = items.filter((v) => {
      if (aerolinea !== 'todas' && v.codigo_aerolinea !== aerolinea) return false
      if (escalas === 'directo' && v.escalas > 0) return false
      if (escalas === '1' && v.escalas > 1) return false
      return true
    })
    return [...filtrados].sort(COMPARADORES[orden])
  }, [items, orden, escalas, aerolinea])

  function seleccionar(vuelo) {
    navegar('/reserva/tarifas', { state: { vuelo, criterios } })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className="grid gap-4 self-start">
        {criterios?.destino && (
          <Card size="sm">
            <CardContent className="grid gap-1.5">
              <p className="text-sm font-medium">
                Viaje {criterios.vuelta ? 'de ida y vuelta' : 'de ida'} a {etiquetaDe(catalogo, criterios.destino)}
              </p>
              <p className="text-xs text-muted-foreground">
                {criterios.origen && `${etiquetaDe(catalogo, criterios.origen)} → `}
                {etiquetaDe(catalogo, criterios.destino)}
              </p>
              <p className="text-xs text-muted-foreground">
                {criterios.ida}
                {criterios.vuelta ? ` – ${criterios.vuelta}` : ''} · {criterios.pasajeros || 1}{' '}
                {Number(criterios.pasajeros) === 1 ? 'pasajero' : 'pasajeros'}
              </p>
              <button
                type="button"
                className="justify-self-start text-xs font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                Editar búsqueda
              </button>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Ordenar por</span>
            <Select value={orden} onValueChange={setOrden}>
              <SelectTrigger className="w-full">
                <SelectValue>{etiquetaDeOrden}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ORDENES.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Escalas</span>
            <Select value={escalas} onValueChange={setEscalas}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v) => ETIQUETAS_ESCALAS[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Cualquier número de escalas</SelectItem>
                <SelectItem value="directo">Sólo directos</SelectItem>
                <SelectItem value="1">Hasta 1 escala</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Aerolíneas</span>
            <Select value={aerolinea} onValueChange={setAerolinea}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v) => (v === 'todas' ? 'Todas las aerolíneas' : aerolineas.find(([c]) => c === v)?.[1])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las aerolíneas</SelectItem>
                {aerolineas.map(([codigo, nombre]) => (
                  <SelectItem key={codigo} value={codigo}>
                    {nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </aside>

      <ul className="grid gap-3">
        {visibles.map((v) => (
          <li key={v.id}>
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground"
                  aria-hidden="true"
                >
                  {v.codigo_aerolinea}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{v.aerolinea}</p>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="tabular-nums">{hora(v.salida)}</span>
                    <span className="font-medium text-foreground">{v.origen}</span>
                    <span className="h-px flex-1 bg-border" aria-hidden="true" />
                    <span className="font-medium text-foreground">{v.destino}</span>
                    <span className="tabular-nums">{hora(v.llegada)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {duracion(v.duracion_min)} · {escalasTexto(v.escalas)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold">{formatearPrecio(v.precio)}</p>
                  <p className="text-xs text-muted-foreground">total</p>
                </div>
                <Button type="button" onClick={() => seleccionar(v)}>
                  Seleccionar
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}

        {visibles.length === 0 && (
          <li className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Ningún vuelo coincide con estos filtros.
          </li>
        )}
      </ul>
    </div>
  )
}
