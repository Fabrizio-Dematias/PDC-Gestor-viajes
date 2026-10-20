import { useMemo } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import BuscadorViajes from '../components/BuscadorViajes.jsx'
import { resumenOcupacion } from '../components/OcupacionSelector.jsx'
import AvisoInvitado from '../components/resultados/AvisoInvitado.jsx'
import SeccionOculta from '../components/resultados/SeccionOculta.jsx'
import SeccionResultados from '../components/resultados/SeccionResultados.jsx'
import ViajeConTramos from '../components/resultados/ViajeConTramos.jsx'
import { MOTIVO } from '../dominio/estados.js'
import { fechaCorta } from '../dominio/formato.js'
import { etiquetaDe } from '../dominio/lugares.js'
import { decodificarTramos } from '../dominio/tramos.js'
import { useLugares } from '../api/lugares.js'
import { useAgencia } from '../api/tenant.js'
import { VERTICALES, verticalPorId } from '../dominio/verticales.jsx'
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

  // Multidestino (§4-bis): la solapa mandó una lista de tramos en vez
  // de un origen/destino/fecha único — `verticalMultidestino` es el
  // vertical dueño de esos tramos (el que realmente se buscó), el
  // resto de los verticales lo tratan como cualquier otra búsqueda que
  // no trae sus campos: campos_insuficientes, como corresponde.
  const tramos = useMemo(() => decodificarTramos(criterios), [criterios])
  const verticalMultidestino =
    tramos && verticalPorId(criterios.vertical)?.soportaMultidestino ? verticalPorId(criterios.vertical) : null

  // Traslado (§4-bis): "ida y vuelta" con el regreso desde otro lugar
  // no es una lista de tramos, son siempre dos — recogida y regreso—,
  // así que se resuelve directo con los mismos `destino`/`vuelta`/
  // `destino_vuelta` del criterio, sin pasar por `tramos`.
  const verticalIdaVuelta =
    !verticalMultidestino && criterios.vuelta && verticalPorId(criterios.vertical)?.permiteVueltaOtroLugar
      ? verticalPorId(criterios.vertical)
      : null

  // Vuelos de ida y vuelta: son dos búsquedas (origen→destino el día de
  // la ida, destino→origen el día de la vuelta) y hay que elegir un
  // vuelo de cada una. Se resuelve igual que el multidestino: una lista
  // de tramos (`ViajeConTramos`).
  const vuelosIdaVuelta =
    !verticalMultidestino && criterios.vuelta && criterios.vertical === 'vuelos' && criterios.origen
      ? verticalPorId('vuelos')
      : null

  // Sin destino no hay nada que buscar: las queries quedarían
  // deshabilitadas y la pantalla mostraría esqueletos para siempre.
  const sinDestino = verticalMultidestino ? tramos.some((t) => !t.destino) : !criterios.destino

  // Cuatro capas, en orden: qué campos trajo esta búsqueda, si el
  // vertical es el que realmente se eligió en la solapa (no alcanza con
  // que sus campos también estén — buscar "Vuelos" trae destino+ida,
  // que a Hospedaje también le alcanzarían, pero no es lo que se pidió),
  // qué habilitó la agencia (pública, `/api/tenant/config`) y qué
  // quiere ver el usuario. Un vertical filtrado en cualquiera de las
  // cuatro no se pide: no puede fallar lo que no se llama.
  //
  // `criterios.vertical` puede faltar (un link viejo, armado antes de
  // que la solapa mandara este campo): sin él, no se filtra por solapa
  // y sólo importan los campos, como se comportaba antes. Los
  // verticales con tratamiento especial (multidestino, ida y vuelta
  // con otro lugar) se resuelven aparte (más abajo) y no entran acá.
  const decididos = VERTICALES.filter(
    (v) => v.id !== verticalMultidestino?.id && v.id !== verticalIdaVuelta?.id && v.id !== vuelosIdaVuelta?.id,
  ).map((vertical) => {
    if (vertical.camposBusqueda.some((campo) => !criterios[campo])) {
      return { vertical, visible: false, motivo: MOTIVO.CAMPOS_INSUFICIENTES }
    }
    if (criterios.vertical && criterios.vertical !== vertical.id) {
      return { vertical, visible: false, motivo: MOTIVO.OTRA_PESTANA }
    }
    if (!agencia.verticales_habilitados.includes(vertical.id)) {
      return { vertical, visible: false, motivo: MOTIVO.APAGADO_POR_ADMIN }
    }
    if (!perfil.preferencias[vertical.id]) {
      return { vertical, visible: false, motivo: MOTIVO.DESACTIVADO_POR_USUARIO }
    }
    return { vertical, visible: true }
  })

  // Mismo criterio de apagado/preferencias que el resto, para los
  // verticales con tratamiento especial (no pasan por `decididos`).
  const motivoOculto = (vertical) =>
    !vertical
      ? null
      : !agencia.verticales_habilitados.includes(vertical.id)
        ? MOTIVO.APAGADO_POR_ADMIN
        : !perfil.preferencias[vertical.id]
          ? MOTIVO.DESACTIVADO_POR_USUARIO
          : null
  const multidestinoOculto = motivoOculto(verticalMultidestino)
  const idaVueltaOculto = motivoOculto(verticalIdaVuelta)
  const vuelosIdaVueltaOculto = motivoOculto(vuelosIdaVuelta)

  const visibles = decididos.filter((d) => d.visible)
  const hayResultados =
    visibles.length > 0 ||
    (verticalMultidestino && !multidestinoOculto) ||
    (verticalIdaVuelta && !idaVueltaOculto) ||
    (vuelosIdaVuelta && !vuelosIdaVueltaOculto)

  // Los tramos de un viaje con elección (ida y vuelta, multidestino).
  const tramosMulti = verticalMultidestino
    ? tramos.map((t, i) => ({
        id: `${verticalMultidestino.id}-${i}`,
        corto: `${verticalMultidestino.etiquetaTramo} ${i + 1}`,
        titulo: `${verticalMultidestino.etiquetaTramo} ${i + 1} · ${
          t.origen ? `${etiquetaDe(catalogo, t.origen)} → ` : ''
        }${etiquetaDe(catalogo, t.destino)} · ${fechaCorta(`${t.fecha}T00:00:00Z`)}`,
        criterios: { origen: t.origen, destino: t.destino, ida: t.fecha, pasajeros: criterios.pasajeros },
      }))
    : []
  const tramosIdaVuelta = vuelosIdaVuelta
    ? [
        {
          id: 'vuelos-ida',
          corto: 'Ida',
          titulo: `Vuelo de ida · ${etiquetaDe(catalogo, criterios.origen)} → ${etiquetaDe(catalogo, criterios.destino)} · ${fechaCorta(`${criterios.ida}T00:00:00Z`)}`,
          criterios: { origen: criterios.origen, destino: criterios.destino, ida: criterios.ida, pasajeros: criterios.pasajeros },
        },
        {
          id: 'vuelos-vuelta',
          corto: 'Vuelta',
          titulo: `Vuelo de vuelta · ${etiquetaDe(catalogo, criterios.destino)} → ${etiquetaDe(catalogo, criterios.origen)} · ${fechaCorta(`${criterios.vuelta}T00:00:00Z`)}`,
          criterios: { origen: criterios.destino, destino: criterios.origen, ida: criterios.vuelta, pasajeros: criterios.pasajeros },
        },
      ]
    : []

  if (sinDestino) return <Navigate to="/" replace />

  return (
    <div className="grid gap-6">
      <BuscadorViajes
        compacto
        valores={criterios}
        onBuscar={(nuevos) => navegar(`/resultados?${new URLSearchParams(nuevos)}`)}
      />

      <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xl font-semibold tracking-tight">
        {verticalMultidestino ? (
          tramos.map((t) => etiquetaDe(catalogo, t.destino)).join(' · ')
        ) : (
          etiquetaDe(catalogo, criterios.destino)
        )}
        <span className="text-sm font-normal text-muted-foreground">
          {verticalMultidestino ? (
            `${tramos.length} tramos`
          ) : (
            <>
              {fechaCorta(`${criterios.ida}T00:00:00Z`)}
              {criterios.vuelta ? ` → ${fechaCorta(`${criterios.vuelta}T00:00:00Z`)}` : ''}
            </>
          )}{' '}
          ·{' '}
          {criterios.habitaciones
            ? resumenOcupacion(criterios)
            : `${criterios.pasajeros || 1} ${Number(criterios.pasajeros) === 1 ? 'pasajero' : 'pasajeros'}`}
        </span>
      </h1>

      {!estaAutenticado && <AvisoInvitado />}

      {!hayResultados && (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          No hay ningún servicio habilitado para mostrar. Revisá tus
          preferencias en el perfil.
        </p>
      )}

      {verticalMultidestino &&
        (multidestinoOculto ? (
          <SeccionOculta vertical={verticalMultidestino} motivo={multidestinoOculto} />
        ) : (
          // Una clave por búsqueda: al buscar otra cosa se descartan las
          // elecciones del viaje anterior.
          <ViajeConTramos
            key={params.toString()}
            vertical={verticalMultidestino}
            tramos={tramosMulti}
            criterios={criterios}
          />
        ))}

      {vuelosIdaVuelta &&
        (vuelosIdaVueltaOculto ? (
          <SeccionOculta vertical={vuelosIdaVuelta} motivo={vuelosIdaVueltaOculto} />
        ) : (
          <ViajeConTramos
            key={params.toString()}
            vertical={vuelosIdaVuelta}
            tramos={tramosIdaVuelta}
            criterios={criterios}
          />
        ))}

      {verticalIdaVuelta &&
        (idaVueltaOculto ? (
          <SeccionOculta vertical={verticalIdaVuelta} motivo={idaVueltaOculto} />
        ) : (
          <>
            <SeccionResultados
              vertical={{
                ...verticalIdaVuelta,
                id: `${verticalIdaVuelta.id}-ida`,
                titulo: `${verticalIdaVuelta.titulo} de ida · ${etiquetaDe(catalogo, criterios.destino)}`,
              }}
              criterios={{ destino: criterios.destino, ida: criterios.ida, pasajeros: criterios.pasajeros }}
            />
            <SeccionResultados
              vertical={{
                ...verticalIdaVuelta,
                id: `${verticalIdaVuelta.id}-vuelta`,
                titulo: `${verticalIdaVuelta.titulo} de vuelta · ${etiquetaDe(
                  catalogo,
                  criterios.destino_vuelta || criterios.destino,
                )}`,
              }}
              criterios={{
                destino: criterios.destino_vuelta || criterios.destino,
                ida: criterios.vuelta,
                pasajeros: criterios.pasajeros,
              }}
            />
          </>
        ))}

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
