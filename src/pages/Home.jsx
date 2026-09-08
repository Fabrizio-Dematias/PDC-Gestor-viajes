import { useNavigate } from 'react-router-dom'
import BuscadorViajes from '../components/BuscadorViajes.jsx'
import { useLugares } from '../api/lugares.js'
import { CRITERIOS_INICIALES } from '../dominio/criterios.js'
import { etiquetaDe } from '../dominio/lugares.js'
import { VERTICALES } from '../dominio/verticales.jsx'
import { usePerfil } from '../api/perfil.js'

export default function Home() {
  const navegar = useNavigate()
  const [perfil] = usePerfil()
  const catalogo = useLugares()

  const activos = VERTICALES.filter((v) => perfil.preferencias[v.id])
  const origen = CRITERIOS_INICIALES.origen
  const destinos = catalogo.rutas[origen]?.length ?? 0

  return (
    <div className="grid gap-6 pt-4 sm:pt-8">
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">¿A dónde viajás?</h1>

      <BuscadorViajes
        valores={CRITERIOS_INICIALES}
        onBuscar={(criterios) =>
          navegar(`/resultados?${new URLSearchParams(criterios)}`)
        }
      />

      <p className="text-xs text-muted-foreground">
        Buscando en{' '}
        {activos.length > 0
          ? activos.map((v) => v.titulo.toLowerCase()).join(' y ')
          : 'ningún servicio — activá alguno en tu perfil'}
        .{' '}
        {destinos > 0 && (
          <>
            {destinos} destinos con vuelo directo desde{' '}
            {etiquetaDe(catalogo, origen)}.
          </>
        )}
      </p>
    </div>
  )
}
