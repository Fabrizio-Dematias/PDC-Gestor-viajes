import { Card, CardContent } from '@/components/ui/card.jsx'
import { diasDeDiferencia, duracionTexto, fechaCorta, horaDeReloj } from '../../dominio/formato.js'

function textoEscalas(v) {
  if (v.escalas === 0) return 'Directo'
  const segmentos = v.segmentos ?? []
  const paradas = segmentos.slice(0, -1).map((s, i) => (s.cambio_aeropuerto ? `${s.destino} → ${segmentos[i + 1].origen}` : s.destino))
  return `${v.escalas === 1 ? '1 escala' : `${v.escalas} escalas`}${paradas.length ? ` · ${paradas.join(', ')}` : ''}`
}

/** Los vuelos del viaje, uno por tarjeta, con la etiqueta de cada tramo
 *  ("Ida", "Vuelta") cuando hay más de uno. */
export default function ResumenVuelos({ vuelos, etiquetas }) {
  return (
    <div className="grid gap-3">
      {vuelos.map((v, i) => {
        const dias = diasDeDiferencia(v.salida, v.llegada)
        const etiqueta = etiquetas?.[i] ?? (vuelos.length === 2 ? (i === 0 ? 'Ida' : 'Vuelta') : vuelos.length > 2 ? `Vuelo ${i + 1}` : null)
        return (
          <Card size="sm" key={v.id}>
            <CardContent className="flex flex-wrap items-center gap-4">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground"
                aria-hidden="true"
              >
                {v.codigo_aerolinea}
              </div>
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-medium">
                  {etiqueta && <span className="mr-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{etiqueta}</span>}
                  {v.aerolinea}
                </p>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground tabular-nums">{horaDeReloj(v.salida)}</span>
                  <span className="font-medium text-foreground">{v.origen}</span>
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  <span className="font-medium text-foreground">{v.destino}</span>
                  <span className="font-medium text-foreground tabular-nums">
                    {horaDeReloj(v.llegada)}
                    {dias > 0 && <sup className="ml-0.5 text-[0.65rem] font-semibold text-[var(--alerta)]">+{dias}</sup>}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {fechaCorta(v.salida)} · {duracionTexto(v.duracion_min)} · {textoEscalas(v)}
                </p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
