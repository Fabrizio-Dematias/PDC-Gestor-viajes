import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BuscadorViajes from '../components/BuscadorViajes.jsx'
import ConfianzaBadges from '../components/ConfianzaBadges.jsx'
import { CRITERIOS_INICIALES } from '../dominio/criterios.js'

export default function Home() {
  const navegar = useNavigate()
  const [pestana, setPestana] = useState(CRITERIOS_INICIALES.vertical ?? 'vuelos')

  return (
    <div className="grid gap-10">
      <div className="hero">
        <h1 className="hero__titulo">¿A dónde viajás?</h1>

        <BuscadorViajes
          valores={CRITERIOS_INICIALES}
          onPestanaChange={setPestana}
          onBuscar={(criterios) =>
            navegar(`/resultados?${new URLSearchParams(criterios)}`)
          }
        />
      </div>

      <ConfianzaBadges vertical={pestana} />
    </div>
  )
}
