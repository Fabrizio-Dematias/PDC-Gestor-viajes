import { Card, CardContent } from '@/components/ui/card.jsx'
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

function escalas(n) {
  if (n === 0) return 'Directo'
  return n === 1 ? '1 escala' : `${n} escalas`
}

export default function ListaVuelos({ items }) {
  return (
    <ul className="grid gap-3">
      {items.map((v) => (
        <li key={v.id}>
          <Card>
            <CardContent className="flex items-center gap-4">
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
                  {duracion(v.duracion_min)} · {escalas(v.escalas)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold">{formatearPrecio(v.precio)}</p>
                <p className="text-xs text-muted-foreground">total</p>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
