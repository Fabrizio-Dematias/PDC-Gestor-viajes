import { Navigate } from 'react-router-dom'
import PanelAdmin from '../components/admin/PanelAdmin.jsx'
import { useConfigAdmin, usePreferenciasAgregadas } from '../api/perfil.js'
import { useSesion } from '../estado/sesion.js'

export default function Admin() {
  const { estaAutenticado, usuario } = useSesion()
  const [config, setConfig] = useConfigAdmin()
  const agregadas = usePreferenciasAgregadas()

  // Ruta protegida por rol, validado del lado del servidor (Módulo 5):
  // el rol sale del JWT, no de un `<select>` que el propio usuario
  // podía editar hasta la Etapa 3. Mismo `/login` que cualquier cuenta
  // — el backend ya sabe si el identificador es un email o un username.
  if (!estaAutenticado || usuario.rol !== 'admin') return <Navigate to="/login" replace />

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administración</h1>
      <PanelAdmin
        config={config}
        agregadas={agregadas}
        onToggle={(id, estado) => setConfig({ ...config, [id]: { estado } })}
      />
    </div>
  )
}
