import { Navigate } from 'react-router-dom'
import PanelAdmin from '../components/admin/PanelAdmin.jsx'
import { useConfigAdmin, usePerfil, usePreferenciasAgregadas } from '../api/perfil.js'

export default function Admin() {
  const [perfil] = usePerfil()
  const [config, setConfig] = useConfigAdmin()
  const agregadas = usePreferenciasAgregadas()

  // Ruta protegida por rol. Fase 0–1: el rol sale del perfil local. Con
  // el servicio de Usuarios pasa a validarse contra el token en el
  // servidor — el guard del front nunca es la defensa real (Módulo 5).
  if (perfil.rol !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="pagina">
      <h1>Administración</h1>
      <PanelAdmin
        config={config}
        agregadas={agregadas}
        onToggle={(id, estado) => setConfig({ ...config, [id]: { estado } })}
      />
    </div>
  )
}
