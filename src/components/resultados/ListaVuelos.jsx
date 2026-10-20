import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { useLugares } from '../../api/lugares.js'
import { diasDeDiferencia, duracionTexto, formatearPrecio, horaDeReloj } from '../../dominio/formato.js'
import { buscarLugar, etiquetaDe, nombreDeAeropuerto } from '../../dominio/lugares.js'

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

/** Aerolíneas que intervienen en un itinerario: con escalas pueden ser
 *  varias, y quien filtra por "Iberia" quiere ver también los que la
 *  usan en el segundo tramo. */
function aerolineasDe(v) {
  const tramos = v.segmentos?.length ? v.segmentos : [v]
  return [...new Map(tramos.map((t) => [t.codigo_aerolinea, t.aerolinea])).entries()]
}

/** Dónde se hace cada escala: el aeropuerto de llegada, o "AEP → EZE" si
 *  hay que cambiar de aeropuerto dentro de la ciudad. */
function nombreDeParada(segmentos, i) {
  const s = segmentos[i]
  return s.cambio_aeropuerto ? `${s.destino} → ${segmentos[i + 1].origen}` : s.destino
}

function textoEscalas(v) {
  if (v.escalas === 0) return 'Directo'
  const cuantas = v.escalas === 1 ? '1 escala' : `${v.escalas} escalas`
  const segmentos = v.segmentos ?? []
  if (segmentos.length < 2) return cuantas
  return `${cuantas} · ${segmentos
    .slice(0, -1)
    .map((_, i) => nombreDeParada(segmentos, i))
    .join(', ')}`
}

/** El recorrido entre las dos horas: una línea, con un punto por escala. */
function Trayecto({ paradas }) {
  return (
    <span className="flex min-w-6 flex-1 items-center" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      {paradas.map((p, i) => (
        <span key={i} className="flex flex-1 items-center">
          <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" title={p.destino} />
          <span className="h-px flex-1 bg-border" />
        </span>
      ))}
    </span>
  )
}

function DetalleEscalas({ segmentos }) {
  const catalogo = useLugares()
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer font-medium text-primary underline-offset-2 hover:underline">
        Ver itinerario completo
      </summary>
      <ol className="mt-2 grid gap-3 border-l border-border pl-3">
        {segmentos.map((s, i) => (
          <li key={i} className="grid gap-0.5">
            <p className="text-foreground">
              <span className="tabular-nums font-medium">{horaDeReloj(s.salida)}</span> {etiquetaDe(catalogo, s.origen)}{' '}
              <span className="font-medium">{s.origen}</span> →{' '}
              <span className="tabular-nums font-medium">{horaDeReloj(s.llegada)}</span> {etiquetaDe(catalogo, s.destino)}{' '}
              <span className="font-medium">{s.destino}</span>
            </p>
            <p>
              {s.aerolinea} · {duracionTexto(s.duracion_min)}
            </p>
            {s.espera_min != null && (
              <p className="text-[var(--alerta)]">
                Espera de {duracionTexto(s.espera_min)} en {s.destino}
                {s.cambio_aeropuerto && ' (incluye el cambio de aeropuerto)'}
              </p>
            )}
            {s.cambio_aeropuerto && segmentos[i + 1] && (
              <p className="rounded-md border border-dashed px-2 py-1">
                <span className="font-medium text-foreground">
                  Cambio de aeropuerto en {buscarLugar(catalogo, s.destino)?.ciudad.nombre ?? s.destino}:
                </span>{' '}
                llegás a {nombreDeAeropuerto(catalogo, s.destino)} ({s.destino}) y salís de{' '}
                {nombreDeAeropuerto(catalogo, segmentos[i + 1].origen)} ({segmentos[i + 1].origen}). El traslado entre los
                dos corre por tu cuenta, y son dos pasajes distintos.
              </p>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}

function TarjetaVuelo({ v, elegido, textoBoton, onElegir }) {
  const dias = diasDeDiferencia(v.salida, v.llegada)
  const paradas = v.segmentos?.slice(0, -1) ?? []

  return (
    <Card className={elegido ? 'ring-2 ring-primary' : undefined} data-elegido={elegido || undefined}>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground"
            aria-hidden="true"
          >
            {v.codigo_aerolinea}
          </div>
          <div className="min-w-0 flex-1 basis-56">
            <p className="font-medium">{v.aerolinea}</p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">{horaDeReloj(v.salida)}</span>
              <span className="font-medium text-foreground">{v.origen}</span>
              <Trayecto paradas={paradas} />
              <span className="font-medium text-foreground">{v.destino}</span>
              <span className="font-medium text-foreground tabular-nums">
                {horaDeReloj(v.llegada)}
                {dias > 0 && (
                  <sup className="ml-0.5 text-[0.65rem] font-semibold text-[var(--alerta)]" title={`Llega ${dias} día${dias > 1 ? 's' : ''} después`}>
                    +{dias}
                  </sup>
                )}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {duracionTexto(v.duracion_min)} · {textoEscalas(v)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-semibold">{formatearPrecio(v.precio)}</p>
            <p className="text-xs text-muted-foreground">total</p>
          </div>
          <Button type="button" variant={elegido ? 'secondary' : 'default'} onClick={() => onElegir(v)} aria-pressed={elegido}>
            {elegido && <Check data-icon="inline-start" />}
            {textoBoton}
          </Button>
        </div>
        {v.segmentos?.length > 1 && <DetalleEscalas segmentos={v.segmentos} />}
      </CardContent>
    </Card>
  )
}

/**
 * Resultados de vuelos con el mismo molde de un motor de venta real
 * (barra de filtros a la izquierda, tarjetas a la derecha): ordenar,
 * filtrar por escalas y por aerolínea son enteramente del lado del
 * front, sobre los mismos `items` que ya trajo la búsqueda — no
 * disparan una consulta nueva.
 *
 * Dos modos:
 * - **Directo** (por defecto): "Seleccionar" va a la comparación de
 *   tarifas con ese vuelo.
 * - **Elección** (`onSeleccionar`): es un tramo de un viaje de varios
 *   (ida y vuelta, multidestino). "Elegir" sólo marca el vuelo; quien
 *   arma el viaje (`ViajeConTramos`) sigue cuando están todos elegidos.
 */
export default function ListaVuelos({ items, criterios, onSeleccionar, seleccionadoId, resumen = true }) {
  const [orden, setOrden] = useState('precio_asc')
  const [escalas, setEscalas] = useState('todas')
  const [aerolinea, setAerolinea] = useState('todas')
  const navegar = useNavigate()
  const catalogo = useLugares()

  const aerolineas = useMemo(() => [...new Map(items.flatMap(aerolineasDe)).entries()], [items])

  const visibles = useMemo(() => {
    const filtrados = items.filter((v) => {
      if (aerolinea !== 'todas' && !aerolineasDe(v).some(([codigo]) => codigo === aerolinea)) return false
      if (escalas === 'directo' && v.escalas > 0) return false
      if (escalas === '1' && v.escalas > 1) return false
      return true
    })
    return [...filtrados].sort(COMPARADORES[orden])
  }, [items, orden, escalas, aerolinea])

  function elegir(vuelo) {
    if (onSeleccionar) return onSeleccionar(vuelo)
    navegar('/reserva/tarifas', { state: { vuelos: [vuelo], criterios } })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className="grid gap-4 self-start">
        {resumen && criterios?.destino && (
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

      <ul className="grid content-start gap-3">
        {visibles.map((v) => (
          <li key={v.id}>
            <TarjetaVuelo
              v={v}
              elegido={seleccionadoId === v.id}
              textoBoton={onSeleccionar ? (seleccionadoId === v.id ? 'Elegido' : 'Elegir') : 'Seleccionar'}
              onElegir={elegir}
            />
          </li>
        ))}

        {items.length === 0 && (
          <li className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No encontramos vuelos para este recorrido, ni siquiera con hasta dos escalas. Probá con otra fecha o con
            ciudades más grandes cerca de tu origen o destino.
          </li>
        )}
        {items.length > 0 && visibles.length === 0 && (
          <li className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Ningún vuelo coincide con estos filtros.
          </li>
        )}
      </ul>
    </div>
  )
}
