import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Badge } from '@/components/ui/badge.jsx'
import { buttonVariants } from '@/components/ui/button.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { formatearPrecio } from '../../dominio/formato.js'

function codigoAlAzar() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join('')
}

export default function Confirmacion() {
  const { state } = useLocation()
  const [codigo] = useState(codigoAlAzar)

  if (!state?.vuelo) return <Navigate to="/resultados" replace />
  const { vuelo, tarifa, pasajeros } = state

  return (
    <div className="mx-auto grid max-w-lg gap-4 py-6 text-center">
      <CheckCircle2 className="mx-auto size-12 text-[var(--ok)]" aria-hidden="true" />
      <h1 className="flex items-center justify-center gap-2 text-xl font-semibold tracking-tight">
        Reserva simulada confirmada <Badge variant="outline">demo</Badge>
      </h1>
      <p className="text-sm text-muted-foreground">
        No se realizó ningún cargo ni se emitió un pasaje real — esto cierra la demostración del flujo de búsqueda,
        selección y datos del pasajero.
      </p>

      <Card className="text-left">
        <CardContent className="grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Código de reserva
            </span>
            <span className="font-mono text-lg font-semibold tracking-wider">{codigo}</span>
          </div>
          <div className="border-t pt-3 text-sm text-muted-foreground">
            <p>
              {vuelo.origen} → {vuelo.destino} · {vuelo.aerolinea}
            </p>
            <p>{tarifa.nombre}</p>
            <p>
              {pasajeros?.length ?? 1} {(pasajeros?.length ?? 1) === 1 ? 'pasajero' : 'pasajeros'}
            </p>
          </div>
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-semibold">{formatearPrecio(tarifa.precio)}</p>
          </div>
        </CardContent>
      </Card>

      <Link to="/" className={buttonVariants({ variant: 'outline' }) + ' justify-self-center'}>
        Volver al inicio
      </Link>
    </div>
  )
}
