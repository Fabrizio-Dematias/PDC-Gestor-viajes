import { Badge } from '@/components/ui/badge.jsx'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { VERTICALES } from '../../dominio/verticales.jsx'
import { useSesion } from '../../estado/sesion.js'
import PanelAdministradores from './PanelAdministradores.jsx'

export default function PanelAdmin({ config, onToggle, agregadas }) {
  const { usuario } = useSesion()
  const permisos = usuario?.permisos ?? []

  return (
    <div className="grid gap-6">
      {permisos.includes('gestion_verticales') && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Disponibilidad por servicio</CardTitle>
              <p className="text-sm text-muted-foreground">
                Apagar un servicio acá lo saca de las búsquedas de todos los usuarios. El agregador deja
                de llamarlo; el usuario ve la misma sección de "no disponible" que vería si el servicio se
                cayera solo.
              </p>
            </CardHeader>
            <CardContent className="grid gap-2">
              {VERTICALES.map((v) => {
                const activo = config[v.id]?.estado !== 'inactivo'
                return (
                  <div key={v.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <span aria-hidden="true">{v.icono}</span>
                    <span className="mr-auto font-medium">{v.titulo}</span>
                    <Badge
                      variant="outline"
                      className={
                        activo
                          ? 'border-transparent bg-[var(--ok-fondo)] text-[var(--ok)]'
                          : 'border-transparent bg-destructive/10 text-destructive'
                      }
                    >
                      {activo ? 'activo' : 'inactivo'}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onToggle(v.id, activo ? 'inactivo' : 'activo')}
                    >
                      {activo ? 'Desactivar' : 'Activar'}
                    </Button>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preferencias de los usuarios</CardTitle>
              <p className="text-sm text-muted-foreground">
                Cuántos de los {agregadas.total_usuarios} usuarios registrados quieren ver cada servicio.
              </p>
            </CardHeader>
            <CardContent className="grid gap-3">
              {VERTICALES.map((v) => {
                const n = agregadas[v.id] ?? 0
                const pct = agregadas.total_usuarios ? Math.round((n / agregadas.total_usuarios) * 100) : 0
                return (
                  <div key={v.id} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
                    <span>{v.titulo}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary" style={{ inlineSize: `${pct}%` }} />
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {n} <span className="text-xs">({pct}%)</span>
                    </span>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </>
      )}

      {permisos.includes('gestion_usuarios') && <PanelAdministradores />}
    </div>
  )
}
