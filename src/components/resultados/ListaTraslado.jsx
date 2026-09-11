import { Car } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { formatearPrecio } from '../../dominio/formato.js'

/**
 * Mismo lenguaje visual que `ListaVuelos.jsx` (tarjeta, ícono en caja,
 * precio a la derecha) — pero sin sumarle una pantalla de selección:
 * traslado sigue siendo lo que ya era, sólo con la mano de pintura al
 * día con el resto.
 */
export default function ListaTraslado({ items }) {
  return (
    <ul className="grid gap-3">
      {items.map((t) => (
        <li key={t.id}>
          <Card>
            <CardContent className="flex items-center gap-4">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                aria-hidden="true"
              >
                <Car className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.vehiculo}</p>
                <p className="text-sm text-muted-foreground">
                  {t.proveedor} · hasta {t.capacidad} pasajeros
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold">{formatearPrecio(t.precio)}</p>
                <p className="text-xs text-muted-foreground">por traslado</p>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
