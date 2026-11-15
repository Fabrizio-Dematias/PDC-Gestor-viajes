import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { useAuditoria } from '../../api/sistema.js'
import { VERTICALES } from '../../dominio/verticales.jsx'

const TITULO = Object.fromEntries(VERTICALES.map((v) => [v.id, v.titulo]))

/** Qué se cambió, en palabras: la columna `vertical` de la tabla guarda
 *  también los cambios de administradores (`admin:x`, `permisos:x`). */
function describir({ vertical, antes, despues }) {
  if (vertical.startsWith('admin:')) return `Alta del administrador ${vertical.slice(6)}`
  if (vertical.startsWith('permisos:')) {
    const lista = (v) => (JSON.parse(v ?? '[]').join(', ') || 'ninguno')
    return `Permisos de ${vertical.slice(9)}: ${lista(antes)} → ${lista(despues)}`
  }
  return `${TITULO[vertical] ?? vertical}: ${antes ?? 'sin configurar'} → ${despues}`
}

const fecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'medium' })

/**
 * Registro de auditoría a la vista (Módulo 5): cada cambio que un
 * administrador hace en la configuración de su agencia queda guardado
 * en el nodo central con quién lo hizo y cuándo. Sólo se ve la agencia
 * propia — el backend filtra por la agencia del token, no por lo que
 * mande el front.
 */
export default function PanelAuditoria() {
  const { habilitado, registros, cargando, error } = useAuditoria()
  if (!habilitado) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Auditoría</CardTitle>
        <p className="text-sm text-muted-foreground">
          Los últimos cambios de configuración de la agencia: quién los hizo y cuándo.
        </p>
      </CardHeader>
      <CardContent className="grid gap-2">
        {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {error && <p className="text-sm text-destructive">No se pudo leer la auditoría.</p>}
        {!cargando && !error && registros.length === 0 && (
          <p className="text-sm text-muted-foreground">Todavía no hubo cambios.</p>
        )}
        {registros.length > 0 && (
          <ul className="grid max-h-80 gap-1.5 overflow-y-auto text-sm">
            {registros.map((r) => (
              <li key={r.id} className="grid gap-x-3 rounded-md border px-3 py-2 sm:grid-cols-[1fr_auto]">
                <span>{describir(r)}</span>
                <span className="text-xs text-muted-foreground tabular-nums sm:text-right">
                  {r.quien} · {fecha.format(new Date(r.cuando))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
