import { useNavigate } from 'react-router-dom'
import BuscadorViajes from '../components/BuscadorViajes.jsx'
import { CRITERIOS_INICIALES } from '../dominio/criterios.js'

export default function Home() {
  const navegar = useNavigate()

  return (
    <div className="hero">
      <h1 className="hero__titulo">¿A dónde viajás?</h1>

      <BuscadorViajes
        valores={CRITERIOS_INICIALES}
        onBuscar={(criterios) =>
          navegar(`/resultados?${new URLSearchParams(criterios)}`)
        }
      />
    </div>
  )
}
