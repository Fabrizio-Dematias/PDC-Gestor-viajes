import { Badge } from '@/components/ui/badge.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { useServiciosDelSistema } from '../../api/sistema.js'

const ESTADOS = {
  pasando: { texto: 'lista', punto: 'bg-[var(--ok)]' },
  critico: { texto: 'no lista', punto: 'bg-destructive' },
  desconocido: { texto: 'sin chequear', punto: 'bg-muted-foreground/50' },
}

/**
 * Servicios del sistema, tal como los ve el registro (Módulo 4): cada
 * servicio con sus instancias, la dirección de cada una y si pasa su
 * health check (`/salud/ready`). Es el descubrimiento de servicios a la
 * vista: levantar una instancia nueva de vuelos hace que aparezca acá
 * sola, y una que se cae o deja de estar lista pasa a "no lista" en unos
 * segundos — y el agregador deja de mandarle tráfico.
 */
export default function PanelServicios() {
  const { habilitado, datos, cargando, error } = useServiciosDelSistema()
  if (!habilitado) return null

  const servicios = Object.entries(datos?.servicios ?? {})
  const sinRegistro = datos?.registro === 'no_disponible' || error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Servicios del sistema
          {datos && (
            <Badge
              variant="outline"
              className={
                sinRegistro
                  ? 'border-transparent bg-[var(--alerta-fondo)] text-[var(--alerta)]'
                  : 'border-transparent bg-[var(--ok-fondo)] text-[var(--ok)]'
              }
            >
              registro {sinRegistro ? 'no disponible' : 'disponible'}
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Cada servicio se anota en el registro al arrancar y se consulta su estado de salud cada pocos
          segundos. El agregador reparte las búsquedas entre las instancias <em>listas</em>: una que no
          pasa el chequeo deja de recibir tráfico sin reiniciarla.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {cargando && <p className="text-sm text-muted-foreground">Consultando el registro…</p>}

        {sinRegistro && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            El registro de servicios no responde. El sistema sigue funcionando con las direcciones fijas de
            configuración; se pierde el descubrimiento dinámico, no el servicio.
          </p>
        )}

        {!sinRegistro &&
          servicios.map(([nombre, instancias]) => (
            <div key={nombre} className="grid gap-1.5 rounded-lg border p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                {nombre}
                <span className="text-xs font-normal text-muted-foreground">
                  {instancias.length} {instancias.length === 1 ? 'instancia' : 'instancias'}
                </span>
              </p>
              {instancias.length === 0 && <p className="text-xs text-muted-foreground">Ninguna instancia registrada.</p>}
              {instancias.map((i) => {
                const e = ESTADOS[i.estado] ?? ESTADOS.desconocido
                return (
                  <div key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    <span className={`size-2 shrink-0 rounded-full ${e.punto}`} aria-hidden="true" />
                    <span className="font-medium">{e.texto}</span>
                    <code className="text-muted-foreground">{i.url}</code>
                    {i.latencia_ms !== undefined && <span className="tabular-nums text-muted-foreground">{i.latencia_ms} ms</span>}
                    {i.detalle && <span className="text-destructive">{i.detalle}</span>}
                  </div>
                )
              })}
            </div>
          ))}
      </CardContent>
    </Card>
  )
}
