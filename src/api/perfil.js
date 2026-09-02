import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { escribir, leer } from '../estado/almacen.js'
import { VERTICALES } from '../dominio/verticales.jsx'
import { HAY_BACKEND, URL_API, USUARIO_ID } from './cliente.js'

/**
 * Perfil y configuración de administración.
 *
 * Los mismos hooks sirven en los dos modos: con backend hablan con el
 * agregador (que reenvía al servicio de usuarios), y sin backend usan
 * localStorage. Los componentes no saben en cuál están.
 */

const todos = (valor) => Object.fromEntries(VERTICALES.map((v) => [v.id, valor]))

const PERFIL_POR_DEFECTO = {
  id: USUARIO_ID,
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
    headers: { 'content-type': 'application/json', 'x-usuario-id': USUARIO_ID },
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
function useRecurso({ clave, porDefecto, obtener, guardar }) {
  const qc = useQueryClient()
  const temporizador = useRef(null)

  const { data } = useQuery({
    queryKey: [clave],
    queryFn: obtener,
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
  return useRecurso({
    clave: 'perfil',
    porDefecto: PERFIL_POR_DEFECTO,
    obtener: () =>
      HAY_BACKEND ? pedir('/api/perfil') : leer('perfil', PERFIL_POR_DEFECTO),
    guardar: (perfil) =>
      HAY_BACKEND
        ? pedir('/api/perfil', { metodo: 'PUT', cuerpo: perfil })
        : (escribir('perfil', perfil), perfil),
  })
}

export function useConfigAdmin() {
  const [config, fijarTodo] = useRecurso({
    clave: 'config-admin',
    porDefecto: CONFIG_POR_DEFECTO,
    obtener: () =>
      HAY_BACKEND ? pedir('/api/admin/config') : leer('config-admin', CONFIG_POR_DEFECTO),
    guardar: (nueva) => {
      if (!HAY_BACKEND) {
        escribir('config-admin', nueva)
        return nueva
      }
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
  const { data } = useQuery({
    queryKey: ['preferencias-agregadas'],
    queryFn: () =>
      HAY_BACKEND ? pedir('/api/admin/preferencias-agregadas') : AGREGADAS_SIMULADAS,
    placeholderData: AGREGADAS_SIMULADAS,
    staleTime: 60_000,
  })
  return data ?? AGREGADAS_SIMULADAS
}
