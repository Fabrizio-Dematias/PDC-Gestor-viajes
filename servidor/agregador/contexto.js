import { pedirJson } from '../comun/pedir.js'
import { urlServicio } from '../comun/descubrimiento.js'
import { CONFIG } from '../comun/config.js'

/**
 * Contexto de una búsqueda: qué verticales apagó el administrador de la
 * agencia y cuáles ocultó el usuario en sus preferencias. Lo lee el
 * servicio de usuarios (Postgres en el nodo central).
 *
 * ## Por qué hay una caché acá
 *
 * Cada búsqueda del front dispara una request por vertical (contrato
 * §4), y cada una necesitaba la configuración de la agencia y el perfil
 * del usuario: con tres secciones, seis viajes a Postgres por búsqueda.
 * Con la base en Supabase cada uno cuesta entre 0,3 y 1,7 s desde esta
 * red, así que *antes de llamar siquiera a vuelos* ya se había gastado
 * buena parte del presupuesto de 3 s del front — y las secciones
 * aparecían como "no disponible por timeout" aunque vuelos respondiera
 * en 15 ms. El problema no era de ningún vertical: era el costo de
 * decidir a quién llamar.
 *
 * Se resuelve con tres cosas, de menor a mayor sutileza:
 *
 * 1. **Caché corta** (15 s): la configuración de una agencia y las
 *    preferencias de un usuario cambian poco, y de todas formas sólo
 *    las cambia alguien a través de este mismo agregador, que invalida
 *    la entrada apenas escribe (`invalidar*`). Otro agregador, si lo
 *    hubiera, se enteraría a lo sumo 15 s después.
 * 2. **Una sola lectura compartida** entre las tres requests paralelas
 *    de una misma búsqueda (`enVuelo`): no tiene sentido que tres
 *    secciones pregunten lo mismo al mismo tiempo.
 * 3. **Copia de respaldo** (10 min) si usuarios no responde: se usa la
 *    última configuración conocida en vez de asumir "todo habilitado".
 *    Sigue valiendo el principio de fallar abierto (contrato §7) cuando
 *    ni siquiera hay una copia — pero ahora una caída corta de usuarios
 *    ya no hace reaparecer lo que el administrador había apagado.
 */
const TTL_MS = Number(process.env.CONTEXTO_TTL_MS ?? 15_000)
const RESPALDO_MS = 10 * 60_000

const entradas = new Map() // clave → { valor, venceEn, caducaEn }
const enVuelo = new Map() // clave → Promise (lecturas en curso)

async function conCache(clave, cargar) {
  const ahora = Date.now()
  const guardada = entradas.get(clave)
  if (guardada && guardada.venceEn > ahora) return guardada.valor
  if (enVuelo.has(clave)) return enVuelo.get(clave)

  const lectura = cargar()
    .then((valor) => {
      entradas.set(clave, { valor, venceEn: Date.now() + TTL_MS, caducaEn: Date.now() + RESPALDO_MS })
      return valor
    })
    .catch((error) => {
      if (guardada && guardada.caducaEn > Date.now()) {
        console.warn(`[agregador] usuarios no responde (${error?.motivo ?? 'error'}): se usa la copia de hace ${Math.round((Date.now() - guardada.venceEn + TTL_MS) / 1000)} s`)
        return guardada.valor
      }
      throw error
    })
    .finally(() => enVuelo.delete(clave))
  enVuelo.set(clave, lectura)
  return lectura
}

const cabeceraAgencia = (agenciaId) => ({ 'x-agencia-id': agenciaId })

const leerConfig = (agenciaId) =>
  conCache(`config:${agenciaId}`, async () => {
    const r = await pedirJson(`${urlServicio('usuarios')}/api/admin/config`, {
      timeoutMs: CONFIG.timeouts.contexto,
      headers: cabeceraAgencia(agenciaId),
    })
    if (!r.ok) throw new Error(`config → ${r.estado}`)
    return r.datos ?? {}
  })

const leerPerfil = (usuarioId, agenciaId) =>
  conCache(`perfil:${usuarioId}`, async () => {
    const r = await pedirJson(`${urlServicio('usuarios')}/api/perfil`, {
      timeoutMs: CONFIG.timeouts.contexto,
      headers: { ...cabeceraAgencia(agenciaId), 'x-usuario-id': usuarioId },
    })
    if (!r.ok) throw new Error(`perfil → ${r.estado}`)
    return r.datos?.preferencias ?? {}
  })

/** Hay que llamarla después de cada escritura que pase por este
 *  agregador: es lo que hace que el cambio se vea de inmediato en vez
 *  de al vencer la caché. */
export const invalidarConfig = (agenciaId) => entradas.delete(`config:${agenciaId}`)
export const invalidarPerfil = (usuarioId) => entradas.delete(`perfil:${usuarioId}`)

/**
 * Preferencias del usuario + configuración del administrador de esta
 * agencia. `usuarioId` puede ser `undefined` (invitado): en ese caso ni
 * se pregunta por un perfil que no existe, y las preferencias quedan
 * "todo activado" directamente — buscar sin cuenta tiene que andar
 * igual de bien que con una.
 *
 * Si el servicio de usuarios no responde y no hay ninguna copia, **se
 * falla abierto**: se asume que todo está habilitado. Es la decisión
 * menos mala. Fallar cerrado dejaría al usuario sin ninguna sección por
 * una caída que no tiene nada que ver con vuelos ni con hospedaje —
 * convertiría el fallo de un servicio secundario en una caída total,
 * que es exactamente lo que este sistema existe para evitar.
 */
export async function contexto(usuarioId, agenciaId) {
  try {
    const [config, preferencias] = await Promise.all([
      leerConfig(agenciaId),
      usuarioId ? leerPerfil(usuarioId, agenciaId) : {},
    ])
    return { config, preferencias, degradado: false }
  } catch (error) {
    console.warn(
      `[agregador] usuarios no responde (${error?.motivo ?? 'error'}): se busca en todos los verticales`,
    )
    return { config: {}, preferencias: {}, degradado: true }
  }
}
