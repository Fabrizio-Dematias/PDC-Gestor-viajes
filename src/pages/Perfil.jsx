import { Navigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import EncuestaPreferencias from '../components/perfil/EncuestaPreferencias.jsx'
import { usePerfil } from '../api/perfil.js'
import { useSesion } from '../estado/sesion.js'

export default function Perfil() {
  const { estaAutenticado } = useSesion()
  const [perfil, setPerfil] = usePerfil()

  // Ruta protegida por sesión (contrato §10): sin cuenta no hay un
  // perfil que editar. El login se ofrece, no se fuerza — esta es la
  // única pantalla que lo exige de verdad.
  if (!estaAutenticado) return <Navigate to="/login" replace />

  return (
    <div className="mx-auto grid max-w-md gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Mi perfil</h1>

      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              value={perfil.nombre}
              onChange={(e) => setPerfil({ ...perfil, nombre: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rol">Rol</Label>
            <Input id="rol" value={perfil.rol} disabled />
            <p className="text-xs text-muted-foreground">
              El rol lo asigna un administrador — ya no se elige acá.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferencias</CardTitle>
        </CardHeader>
        <CardContent>
          <EncuestaPreferencias
            preferencias={perfil.preferencias}
            onCambiar={(id, valor) =>
              setPerfil({
                ...perfil,
                preferencias: { ...perfil.preferencias, [id]: valor },
              })
            }
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Los servicios que desactives no se consultan en tus búsquedas.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
