import { Briefcase, Check, CreditCard, Luggage } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent } from '@/components/ui/card.jsx'
import { formatearPrecio } from '../../dominio/formato.js'
import { tarifasDe } from '../../dominio/tarifas.js'

function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

/**
 * Comparación de tarifas — la pantalla que sigue a "Seleccionar" en
 * `ListaVuelos.jsx`. El vuelo y los criterios de la búsqueda viajan por
 * `location.state` (contrato interno de esta mini-ruta, no del
 * agregador): no hay un "pedido" persistido del otro lado, así que no
 * hay nada que pedirle a un backend por id. Entrar acá sin haber
 * pasado por la lista (recarga de página, link directo) no tiene datos
 * para mostrar — se manda de vuelta a resultados.
 */
export default function Tarifas() {
  const { state } = useLocation()
  const navegar = useNavigate()
  const [seleccionada, setSeleccionada] = useState('basica')

  if (!state?.vuelo) return <Navigate to="/resultados" replace />

  const { vuelo, criterios } = state
  const tarifas = tarifasDe(vuelo)
  const tarifa = tarifas.find((t) => t.id === seleccionada)

  return (
    <div className="grid gap-6">
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-4">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground"
            aria-hidden="true"
          >
            {vuelo.codigo_aerolinea}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{vuelo.aerolinea}</p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="tabular-nums">{hora(vuelo.salida)}</span>
              <span className="font-medium text-foreground">{vuelo.origen}</span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="font-medium text-foreground">{vuelo.destino}</span>
              <span className="tabular-nums">{hora(vuelo.llegada)}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="grid gap-4 sm:grid-cols-3">
          {tarifas.map((t) => {
            const activa = t.id === seleccionada
            return (
              <button key={t.id} type="button" onClick={() => setSeleccionada(t.id)} className="text-left">
                <Card
                  className={`h-full transition-colors ${activa ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-foreground/20'}`}
                >
                  <CardContent className="grid gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {t.nombre}
                      </span>
                      {activa && (
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3" aria-hidden="true" />
                        </span>
                      )}
                    </div>
                    <ul className="grid gap-1.5 text-sm text-muted-foreground">
                      <li className="flex items-center gap-2">
                        <CreditCard className="size-4 shrink-0" aria-hidden="true" /> {t.cambio}
                      </li>
                      <li className="flex items-center gap-2">
                        <Briefcase className="size-4 shrink-0" aria-hidden="true" /> {t.reembolso}
                      </li>
                      <li className="flex items-center gap-2">
                        <Luggage className="size-4 shrink-0" aria-hidden="true" /> {t.equipaje}
                      </li>
                    </ul>
                    <p className="mt-auto pt-2 text-lg font-semibold text-foreground">
                      {formatearPrecio(t.precio)}
                    </p>
                  </CardContent>
                </Card>
              </button>
            )
          })}
        </div>

        <Card className="h-fit">
          <CardContent className="grid gap-3">
            <h2 className="font-medium">Resumen</h2>
            <p className="text-sm text-muted-foreground">
              Vendido por <span className="text-foreground">{vuelo.aerolinea}</span>
            </p>
            <ul className="grid gap-1.5 text-sm text-muted-foreground">
              <li>{tarifa.cambio}</li>
              <li>{tarifa.reembolso}</li>
              <li>{tarifa.equipaje}</li>
            </ul>
            <div className="mt-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-semibold">{formatearPrecio(tarifa.precio)}</p>
            </div>
            <Button
              type="button"
              className="mt-2"
              onClick={() => navegar('/reserva/datos', { state: { vuelo, criterios, tarifa } })}
            >
              Continuar
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
