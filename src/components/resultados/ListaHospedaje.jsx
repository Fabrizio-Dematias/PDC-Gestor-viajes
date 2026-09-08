import { Badge } from '@/components/ui/badge.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { formatearPrecio } from '../../dominio/formato.js'

export default function ListaHospedaje({ items }) {
  return (
    <ul className="grid gap-3">
      {items.map((h) => (
        <li key={h.id}>
          <Card>
            <CardContent className="flex items-center gap-4">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground"
                aria-label={`Puntaje ${h.puntaje}`}
              >
                {h.puntaje.toFixed(1)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{h.nombre}</p>
                <p className="text-sm text-muted-foreground">
                  {'★'.repeat(h.estrellas)}
                  <span className="sr-only">{h.estrellas} estrellas</span> · {h.ciudad} ·{' '}
                  {h.opiniones.toLocaleString('es-AR')} opiniones
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {h.servicios.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold">{formatearPrecio(h.precio)}</p>
                <p className="text-xs text-muted-foreground">{h.noches} noches</p>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
