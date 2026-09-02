/**
 * Prueba de humo del front, sin React y sin backend.
 *
 * Cubre las dos piezas de lógica que no son componentes: la tolerancia a
 * fallos de la capa api/ —los tiempos que imprime son los reales del
 * AbortController, no una animación— y el buscador de lugares.
 *
 * Corre con `npm test`.
 */
import { buscarVertical, TIMEOUT_MS } from '../src/api/cliente.js'
import { SALUD, fijarSalud } from '../src/api/mock/caos.js'
import { esNoDisponible } from '../src/dominio/errores.js'
import { buscarLugares, CATALOGO_SIMULADO, normalizar } from '../src/dominio/lugares.js'

const CRIT = { origen: 'EZE', destino: 'MAD', ida: '2026-10-12', vuelta: '2026-10-22', pasajeros: 2 }
let fallos = 0
const ok = (c, msg) => { console.log(`${c ? '  ok  ' : ' FALLA'} ${msg}`); if (!c) fallos++ }

async function caso(nombre, fn) { console.log(`\n${nombre}`); await fn() }

await caso('vuelos sano', async () => {
  fijarSalud('vuelos', SALUD.OK)
  const t = Date.now()
  const items = await buscarVertical('vuelos', CRIT)
  ok(Array.isArray(items) && items.length === 8, `devuelve 8 vuelos (${items.length})`)
  ok(items.every(v => v.id && v.precio?.moneda === 'ARS'), 'cumple la forma del contrato §2')
  ok(items.every((v,i) => i === 0 || v.precio.monto >= items[i-1].precio.monto), 'ordenados por precio')
  ok(Date.now() - t < TIMEOUT_MS, `responde dentro del presupuesto (${Date.now()-t} ms)`)
})

await caso('hospedaje sano', async () => {
  fijarSalud('hospedaje', SALUD.OK)
  const items = await buscarVertical('hospedaje', CRIT)
  ok(items.length === 8, `devuelve 8 alojamientos (${items.length})`)
  ok(items[0].noches === 10, `calcula 10 noches (${items[0].noches})`)
})

await caso('vuelos caído (503)', async () => {
  fijarSalud('vuelos', SALUD.CAIDO)
  const t = Date.now()
  try {
    await buscarVertical('vuelos', CRIT)
    ok(false, 'debería rechazar')
  } catch (e) {
    ok(esNoDisponible(e), 'rechaza con ServicioNoDisponible')
    ok(e.motivo === 'error', `motivo = error (${e.motivo})`)
    ok(Date.now() - t < 1000, `falla rápido, no espera el timeout (${Date.now()-t} ms)`)
  }
})

await caso('vuelos colgado — el caso que justifica el timeout', async () => {
  fijarSalud('vuelos', SALUD.COLGADO)
  const t = Date.now()
  try {
    await buscarVertical('vuelos', CRIT)
    ok(false, 'debería rechazar')
  } catch (e) {
    const ms = Date.now() - t
    ok(esNoDisponible(e), 'rechaza con ServicioNoDisponible')
    ok(e.motivo === 'timeout', `motivo = timeout (${e.motivo})`)
    ok(ms >= TIMEOUT_MS && ms < TIMEOUT_MS + 400, `cortado por AbortController a los ${ms} ms`)
  }
})

await caso('AISLAMIENTO: vuelos colgado, hospedaje sano, en paralelo', async () => {
  fijarSalud('vuelos', SALUD.COLGADO)
  fijarSalud('hospedaje', SALUD.OK)
  const t = Date.now()
  const [v, h] = await Promise.allSettled([
    buscarVertical('vuelos', CRIT),
    buscarVertical('hospedaje', CRIT),
  ])
  ok(v.status === 'rejected' && v.reason.motivo === 'timeout', 'vuelos → unavailable (timeout)')
  ok(h.status === 'fulfilled' && h.value.length === 8, 'hospedaje → ok, con sus 8 resultados')
  ok(Date.now() - t < TIMEOUT_MS + 400, `el total es el del peor, no la suma (${Date.now()-t} ms)`)
})

await caso('cancelación del usuario (cambia de búsqueda)', async () => {
  fijarSalud('vuelos', SALUD.COLGADO)
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(new DOMException('cancelada', 'AbortError')), 150)
  const t = Date.now()
  try {
    await buscarVertical('vuelos', CRIT, { signal: ctrl.signal })
    ok(false, 'debería rechazar')
  } catch (e) {
    ok(e.name === 'AbortError', `propaga AbortError, no lo confunde con un fallo (${e.name})`)
    ok(Date.now() - t < 500, `corta al instante (${Date.now()-t} ms)`)
  }
})

const primero = (q, permitidos) =>
  buscarLugares(CATALOGO_SIMULADO, q, permitidos).coincidencias[0]

await caso('buscador de lugares: por ciudad, país y código', async () => {
  ok(normalizar('Córdoba') === 'cordoba', 'normaliza acentos y mayúsculas')
  ok(primero('cordoba')?.iata === 'COR', 'escribir sin acento encuentra Córdoba')
  ok(primero('Córdoba')?.iata === 'COR', 'escribirlo con acento también')
  ok(primero('eze')?.iata === 'EZE', 'el código completo va primero')
  ok(primero('ez')?.iata === 'EZE', 'un prefijo del código alcanza')
  ok(primero('espa')?.pais === 'España', 'buscar por país trae sus aeropuertos')
  ok(primero('mendo')?.iata === 'MDZ', 'alcanza con las primeras letras')
  ok(primero('zzzz') === undefined, 'lo que no existe no devuelve nada')
})

await caso('buscador de lugares: sólo lo que se puede volar', async () => {
  const permitidos = CATALOGO_SIMULADO.rutas.EZE
  const { coincidencias, descartadas } = buscarLugares(CATALOGO_SIMULADO, 'buenos', permitidos)
  ok(coincidencias.length === 0, 'no sugiere el propio origen como destino')
  ok(descartadas > 0, `avisa que hay ${descartadas} coincidencias fuera del alcance`)

  const todos = buscarLugares(CATALOGO_SIMULADO, '', permitidos).coincidencias
  ok(
    todos.every((a) => permitidos.includes(a.iata)),
    'con el campo vacío lista sólo destinos alcanzables',
  )
})

console.log(fallos === 0 ? '\n✔ todo en verde' : `\n✘ ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
