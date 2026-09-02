import EncuestaPreferencias from '../components/perfil/EncuestaPreferencias.jsx'
import { usePerfil } from '../api/perfil.js'

export default function Perfil() {
  const [perfil, setPerfil] = usePerfil()

  return (
    <div className="pagina pagina--angosta">
      <h1>Mi perfil</h1>

      <label className="campo">
        <span className="campo__etiqueta">Nombre</span>
        <input
          type="text"
          value={perfil.nombre}
          onChange={(e) => setPerfil({ ...perfil, nombre: e.target.value })}
        />
      </label>

      <EncuestaPreferencias
        preferencias={perfil.preferencias}
        onCambiar={(id, valor) =>
          setPerfil({
            ...perfil,
            preferencias: { ...perfil.preferencias, [id]: valor },
          })
        }
      />

      <p className="nota">
        Los servicios que desactives no se consultan en tus búsquedas.
      </p>

      <label className="campo">
        <span className="campo__etiqueta">
          Rol <span className="etiqueta-demo">demo</span>
        </span>
        <select
          value={perfil.rol}
          onChange={(e) => setPerfil({ ...perfil, rol: e.target.value })}
        >
          <option value="usuario">usuario</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <p className="nota">
        Fase 0–1 no tiene login: el rol se elige a mano para poder entrar a{' '}
        <code>/admin</code>. Lo reemplaza el servicio de Usuarios.
      </p>
    </div>
  )
}
