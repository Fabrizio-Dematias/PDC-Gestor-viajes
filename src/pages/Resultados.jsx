import { useMemo } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import BuscadorViajes from '../components/BuscadorViajes.jsx'
import AvisoInvitado from '../components/resultados/AvisoInvitado.jsx'
import SeccionOculta from '../components/resultados/SeccionOculta.jsx'
import SeccionResultados from '../components/resultados/SeccionResultados.jsx'
import { MOTIVO } from '../dominio/estados.js'
import { etiquetaDe } from '../dominio/lugares.js'
import { useLugares } from '../api/lugares.js'
import { useAgencia } from '../api/tenant.js'
import { VERTICALES } from '../dominio/verticales.jsx'
import { usePerfil } from '../api/perfil.js'
import { useSesion } from '../estado/sesion.js'

export default function Resultados() {
  const [params] = useSearchParams()
  const navegar = useNavigate()
  const [perfil] = usePerfil()
  const agencia = useAgencia()
  const catalogo = useLugares()
  const { estaAutenticado } = useSesion()

  const criterios = useMemo(() => Object.fromEntries(params), [params])

  // Sin destino no hay nada que buscar: las queries quedarían
  // deshabilitadas y la pantalla mostraría esqueletos para siempre.
  const sinDestino = !criterios.destino

  // Tres capas, en orden: qué campos trajo esta búsqueda (la solapa
  // elegida en BuscadorViajes.jsx), qué habilitó la agencia (pública,
  // `/api/tenant/config`) y qué quiere ver el usuario. Un vertical
  // filtrado en cualquiera de las tres no se pide: no puede fallar lo
  // que no se llama.
  const decididos = VERTICALES.map((vertical) => {
    if (vertical.camposBusqueda.some((campo) => !criterios[campo])) {
      return { vertical, visible: false, motivo: MOTIVO.CAMPOS_INSUFICIENTES }
    }
    if (!agencia.verticales_habilitados.includes(vertical.id)) {
      return { vertical, visible: false, motivo: MOTIVO.APAGADO_POR_ADMIN }
    }
    if (!perfil.preferencias[vertical.id]) {
      return { vertical, visible: false, motivo: MOTIVO.DESACTIVADO_POR_USUARIO }
    }
    return { vertical, visible: true }
  })

  const visibles = decididos.filter((d) => d.visible)

  if (sinDestino) return <Navigate to="/" replace />

  return (
    <div className="grid gap-6">
      <BuscadorViajes
        compacto
        valores={criterios}
        onBuscar={(nuevos) => navegar(`/resultados?${new URLSearchParams(nuevos)}`)}
      />

      <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xl font-semibold tracking-tight">
        {etiquetaDe(catalogo, criterios.destino)}
        <span className="text-sm font-normal text-muted-foreground">
          {criterios.ida}
          {criterios.vuelta ? ` → ${criterios.vuelta}` : ''} ·{' '}
          {criterios.pasajeros || 1}{' '}
          {Number(criterios.pasajeros) === 1 ? 'pasajero' : 'pasajeros'}
        </span>
      </h1>

      {!estaAutenticado && <AvisoInvitado />}

      {visibles.length === 0 && (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          No hay ningún servicio habilitado para mostrar. Revisá tus
          preferencias en el perfil.
        </p>
      )}

      {decididos.map(({ vertical, visible, motivo }) =>
        visible ? (
          <SeccionResultados
            key={vertical.id}
            vertical={vertical}
            criterios={criterios}
          />
        ) : (
          <SeccionOculta key={vertical.id} vertical={vertical} motivo={motivo} />
        ),
      )}
    </div>
  )
}
