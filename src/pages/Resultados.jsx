import { useMemo } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import BuscadorViajes from '../components/BuscadorViajes.jsx'
import SeccionOculta from '../components/resultados/SeccionOculta.jsx'
import SeccionResultados from '../components/resultados/SeccionResultados.jsx'
import { MOTIVO } from '../dominio/estados.js'
import { etiquetaDe } from '../dominio/lugares.js'
import { useLugares } from '../api/lugares.js'
import { VERTICALES } from '../dominio/verticales.jsx'
import { useConfigAdmin, usePerfil } from '../api/perfil.js'

export default function Resultados() {
  const [params] = useSearchParams()
  const navegar = useNavigate()
  const [perfil] = usePerfil()
  const [configAdmin] = useConfigAdmin()
  const catalogo = useLugares()

  const criterios = useMemo(() => Object.fromEntries(params), [params])

  // Sin destino no hay nada que buscar: las queries quedarían
  // deshabilitadas y la pantalla mostraría esqueletos para siempre.
  const sinDestino = !criterios.destino

  // El cruce de las dos capas de preferencias del contrato: lo que el
  // usuario quiere ver y lo que el admin habilitó. Un vertical filtrado
  // acá no se pide: no puede fallar lo que no se llama.
  const decididos = VERTICALES.map((vertical) => {
    if (configAdmin[vertical.id]?.estado === 'inactivo') {
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
    <div className="resultados">
      <BuscadorViajes
        compacto
        valores={criterios}
        onBuscar={(nuevos) => navegar(`/resultados?${new URLSearchParams(nuevos)}`)}
      />

      <h1 className="resultados__titulo">
        {etiquetaDe(catalogo, criterios.destino)}
        <span className="resultados__sub">
          {criterios.ida}
          {criterios.vuelta ? ` → ${criterios.vuelta}` : ''} ·{' '}
          {criterios.pasajeros || 1}{' '}
          {Number(criterios.pasajeros) === 1 ? 'pasajero' : 'pasajeros'}
        </span>
      </h1>

      {visibles.length === 0 && (
        <p className="vacio">
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
