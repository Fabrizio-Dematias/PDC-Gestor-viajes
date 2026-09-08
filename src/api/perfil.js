import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { useSesion } from '../estado/sesion.js'
import { escribir, leer } from '../estado/almacen.js'
import { VERTICALES } from '../dominio/verticales.jsx'
import { AGENCIA_ID, cabecerasAuth, HAY_BACKEND, URL_API } from './cliente.js'

/**
 * Perfil y configuración de administración.
 *
 * Los mismos hooks sirven en los dos modos: con backend hablan con el
 * agregador (que reenvía al servicio de usuarios), y sin backend usan
 * localStorage. Los componentes no saben en cuál están.
 *
 * Con login real (contrato §10), `/api/perfil` y todo `/api/admin/*`
 * exigen sesión: sin ella, estos hooks ni siquiera piden — devuelven el
 * valor por defecto directo, como haría un invitado.
 */

const todos = (valor) => Object.fromEntries(VERTICALES.map((v) => [v.id, valor]))

const PERFIL_POR_DEFECTO = {
  nombre: 'Invitado',
  rol: 'usuario',
  preferencias: todos(true),
}
const CONFIG_POR_DEFECTO = todos({ estado: 'activo' })
/** Sin backend no hay usuarios que contar: números fijos y verosímiles
 *  para que el panel se pueda mostrar igual. */
const AGREGADAS_SIMULADAS = { total_usuarios: 128, vuelos: 121, hospedaje: 87 }

async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
  const res = await fetch(`${URL_API}${ruta}`, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      'x-agencia-id': AGENCIA_ID,
      ...cabecerasAuth(),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  if (!res.ok) throw new Error(`${metodo} ${ruta} → ${res.status}`)
  return res.json()
}

/**
 * Un valor editable que vive en el servidor (o en localStorage).
 *
 * La escritura es optimista y con retardo: la pantalla refleja el cambio
 * al instante y la red se toca una sola vez cuando el usuario dejó de
 * escribir. Sin el retardo, editar el nombre mandaría un PUT por tecla.
 */
function useRecurso({ clave, porDefecto, habilitado = true, obtener, guardar }) {
  const qc = useQueryClient()
  const temporizador = useRef(null)

  const { data } = useQuery({
    queryKey: [clave],
    queryFn: obtener,
    enabled: habilitado,
    // `placeholderData` y no `initialData`: con initialData React Query
    // consideraría el valor por defecto ya fresco y no iría a buscar el
    // de verdad.
    placeholderData: porDefecto,
    staleTime: 30_000,
    retry: 1,
  })

  const { mutate } = useMutation({
    mutationFn: guardar,
    onSuccess: (devuelto) => devuelto && qc.setQueryData([clave], devuelto),
  })

  const fijar = useCallback(
    (valor) => {
      qc.setQueryData([clave], valor)
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(() => mutate(valor), 400)
    },
    [clave, mutate, qc],
  )

  return [data ?? porDefecto, fijar]
}

export function usePerfil() {
  const { estaAutenticado, actualizarUsuario } = useSesion()
  const conBackend = HAY_BACKEND && estaAutenticado

  return useRecurso({
    clave: 'perfil',
    porDefecto: PERFIL_POR_DEFECTO,
    habilitado: !HAY_BACKEND || estaAutenticado,
    obtener: () => {
      if (!HAY_BACKEND) return leer('perfil', PERFIL_POR_DEFECTO)
      if (!estaAutenticado) return PERFIL_POR_DEFECTO
      return pedir('/api/perfil')
    },
    guardar: (perfil) => {
      if (!conBackend) {
        if (!HAY_BACKEND) escribir('perfil', perfil)
        return perfil
      }
      return pedir('/api/perfil', { metodo: 'PUT', cuerpo: perfil }).then((actualizado) => {
        actualizarUsuario({ nombre: actualizado.nombre })
        return actualizado
      })
    },
  })
}

export function useConfigAdmin() {
  const { estaAutenticado, usuario } = useSesion()
  const esAdmin = estaAutenticado && usuario?.rol === 'admin'

  const [config, fijarTodo] = useRecurso({
    clave: 'config-admin',
    porDefecto: CONFIG_POR_DEFECTO,
    habilitado: !HAY_BACKEND || esAdmin,
    obtener: () => {
      if (!HAY_BACKEND) return leer('config-admin', CONFIG_POR_DEFECTO)
      if (!esAdmin) return CONFIG_POR_DEFECTO
      return pedir('/api/admin/config')
    },
    guardar: (nueva) => {
      if (!HAY_BACKEND) {
        escribir('config-admin', nueva)
        return nueva
      }
      if (!esAdmin) return nueva
      // El backend expone un endpoint por vertical, no uno para toda la
      // configuración: así queda registrado en la auditoría qué se
      // cambió exactamente.
      const cambios = Object.entries(nueva).filter(
        ([id, v]) => v.estado !== config[id]?.estado,
      )
      return Promise.all(
        cambios.map(([id, v]) =>
          pedir(`/api/admin/config/${id}`, { metodo: 'PUT', cuerpo: v }),
        ),
      ).then((rs) => rs.at(-1) ?? nueva)
    },
  })
  return [config, fijarTodo]
}

export function usePreferenciasAgregadas() {
  const { estaAutenticado, usuario } = useSesion()
  const esAdmin = estaAutenticado && usuario?.rol === 'admin'

  const { data } = useQuery({
    queryKey: ['preferencias-agregadas'],
    queryFn: () => (HAY_BACKEND ? pedir('/api/admin/preferencias-agregadas') : AGREGADAS_SIMULADAS),
    enabled: !HAY_BACKEND || esAdmin,
    placeholderData: AGREGADAS_SIMULADAS,
    staleTime: 60_000,
  })
  return data ?? AGREGADAS_SIMULADAS
}

/** Administradores de la agencia (contrato §10). Sólo con
 *  `gestion_usuarios`; el resto de `PanelAdmin` no la necesita. */
export function useAdministradores() {
  const { estaAutenticado, usuario } = useSesion()
  const puedeGestionar = estaAutenticado && usuario?.permisos?.includes('gestion_usuarios')
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['administradores'],
    queryFn: () => pedir('/api/admin/administradores'),
    enabled: HAY_BACKEND && puedeGestionar,
    placeholderData: [],
  })

  const { mutate: crear, isPending: creando, error: errorCrear } = useMutation({
    mutationFn: ({ username, password, permisos }) =>
      pedir('/api/admin/administradores', { metodo: 'POST', cuerpo: { username, password, permisos } }),
    onSuccess: (lista) => qc.setQueryData(['administradores'], lista),
  })

  const { mutate: cambiarPermisos } = useMutation({
    mutationFn: ({ id, permisos }) =>
      pedir(`/api/admin/administradores/${id}/permisos`, { metodo: 'PUT', cuerpo: { permisos } }),
    onSuccess: (lista) => qc.setQueryData(['administradores'], lista),
  })

  return { administradores: data ?? [], crear, creando, errorCrear, cambiarPermisos, puedeGestionar }
}
