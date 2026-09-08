import { useState } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Checkbox } from '@/components/ui/checkbox.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { useAdministradores } from '../../api/perfil.js'

const PERMISOS = [
  { id: 'gestion_verticales', etiqueta: 'Disponibilidad de verticales' },
  { id: 'gestion_usuarios', etiqueta: 'Gestión de administradores' },
]

/**
 * Gestión de administradores y permisos (contrato §10). Sólo la ve
 * quien ya tiene `gestion_usuarios` — `Admin.jsx` no la renderiza si no.
 * Un administrador nunca ve ni crea administradores de otra agencia:
 * eso lo resuelve el propio backend a partir del token, no un filtro
 * de este componente.
 */
export default function PanelAdministradores() {
  const { administradores, crear, creando, errorCrear, cambiarPermisos } = useAdministradores()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [permisos, setPermisos] = useState([])

  function alternarNuevo(id) {
    setPermisos((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  function enviar(e) {
    e.preventDefault()
    crear({ username, password, permisos })
    setUsername('')
    setPassword('')
    setPermisos([])
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Administradores</CardTitle>
        <p className="text-sm text-muted-foreground">
          Cada administrador ve y gestiona sólo su propia agencia. El permiso decide qué puede tocar,
          además de tener rol admin.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {administradores.map((a) => (
          <div key={a.id} className="grid gap-2 rounded-lg border p-3">
            <span className="font-medium">{a.username}</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {PERMISOS.map((p) => (
                <Label key={p.id} className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                  <Checkbox
                    checked={a.permisos?.includes(p.id) ?? false}
                    onCheckedChange={(checked) => {
                      const nuevos = checked
                        ? [...(a.permisos ?? []), p.id]
                        : (a.permisos ?? []).filter((x) => x !== p.id)
                      cambiarPermisos({ id: a.id, permisos: nuevos })
                    }}
                  />
                  {p.etiqueta}
                </Label>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
      <CardFooter className="block border-t pt-4">
        <form onSubmit={enviar} className="grid gap-4">
          <h3 className="text-sm font-medium">Nuevo administrador</h3>
          <div className="grid gap-1.5">
            <Label htmlFor="nuevo-usuario">Usuario</Label>
            <Input id="nuevo-usuario" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nuevo-password">Contraseña</Label>
            <Input
              id="nuevo-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {PERMISOS.map((p) => (
              <Label key={p.id} className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                <Checkbox checked={permisos.includes(p.id)} onCheckedChange={() => alternarNuevo(p.id)} />
                {p.etiqueta}
              </Label>
            ))}
          </div>
          {errorCrear && <p className="text-sm text-destructive">{errorCrear.message}</p>}
          <Button type="submit" disabled={creando} className="justify-self-start">
            {creando ? 'Creando…' : 'Crear administrador'}
          </Button>
        </form>
      </CardFooter>
    </Card>
  )
}
