/**
 * Prueba de humo del backend distribuido.
 *
 * Requiere los cuatro servicios andando (`npm run back`). Usa el
 * interruptor de fallos de cada vertical, así que no hace falta matar
 * procesos: comprueba aislamiento, timeout y paralelismo contra el
 * sistema real, con los tiempos reales.
 *
 * Corre con `npm run test:back`.
 */
const BASE = process.env.URL_AGREGADOR ?? 'http://localhost:4000'
const CRITERIOS = 'origen=EZE&destino=MAD&ida=2026-10-12&vuelta=2026-10-22&pasajeros=2'

let fallos = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${msg}`)
  if (!cond) fallos++
}
const titulo = (t) => console.log(`\n${t}`)

const json = async (ruta, opciones) => {
  const res = await fetch(`${BASE}${ruta}`, opciones)
  return { estado: res.status, datos: await res.json().catch(() => null) }
}
const salud = (vertical, estado) =>
  json(`/api/demo/salud/${vertical}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado }),
  })
const config = (vertical, estado) =>
  json(`/api/admin/config/${vertical}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado }),
  })
const preferencias = (preferencias) =>
  json('/api/perfil', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preferencias }),
  })

const buscar = async () => {
  const t = Date.now()
  const { datos } = await json(`/api/buscar?${CRITERIOS}`)
  return { ...datos, ms: Date.now() - t }
}
const noDisponible = (r, vertical) => r.no_disponibles.find((n) => n.vertical === vertical)

/**
 * Cuántos resultados da cada vertical con todo sano. Se mide en vez de
 * fijarlo: la cantidad depende de cuántas aerolíneas vuelan la ruta en
 * el dataset, y clavar un número haría que la prueba se rompa cada vez
 * que cambian los datos en lugar de cuando se rompe el sistema.
 */
let referencia = { vuelos: 0, hospedaje: 0 }

async function restaurar() {
  await Promise.all([salud('vuelos', 'ok'), salud('hospedaje', 'ok')])
  await Promise.all([config('vuelos', 'activo'), config('hospedaje', 'activo')])
  await preferencias({ vuelos: true, hospedaje: true })
}

// ---------------------------------------------------------------------

try {
  await fetch(`${BASE}/salud`)
} catch {
  console.error(`No hay nadie en ${BASE}. Levantá el backend con: npm run back`)
  process.exit(1)
}

await restaurar()

titulo('todo sano')
{
  const r = await buscar()
  referencia = { vuelos: r.vuelos.length, hospedaje: r.hospedaje.length }
  ok(r.vuelos.length > 0, `vuelos devuelve ${r.vuelos.length} resultados`)
  ok(r.hospedaje.length > 0, `hospedaje devuelve ${r.hospedaje.length} resultados`)
  ok(
    r.vuelos.every((v) => v.id && v.precio?.moneda && v.salida),
    'los vuelos cumplen la forma del contrato §2',
  )
  ok(r.no_disponibles.length === 0, 'no_disponibles vacío')
  ok(r.ms < 1000, `la búsqueda completa tarda ${r.ms} ms`)
}

titulo('hospedaje caído (503) — el fallo queda contenido')
{
  await salud('hospedaje', 'caido')
  const r = await buscar()
  ok(r.vuelos.length === referencia.vuelos, `vuelos sigue entregando sus ${referencia.vuelos} resultados`)
  ok(Array.isArray(r.hospedaje) && r.hospedaje.length === 0, 'hospedaje viene como [] y no ausente')
  ok(noDisponible(r, 'hospedaje')?.motivo === 'error', 'declarado en no_disponibles con motivo error')
  ok(r.ms < 1000, `no se paga el timeout por un 503 limpio (${r.ms} ms)`)
}

titulo('hospedaje colgado — lo corta el AbortController')
{
  await salud('hospedaje', 'colgado')
  const r = await buscar()
  ok(r.vuelos.length === referencia.vuelos, 'vuelos no se entera')
  ok(noDisponible(r, 'hospedaje')?.motivo === 'timeout', 'motivo timeout')
  ok(r.ms >= 2400 && r.ms < 3400, `cortado a los ${r.ms} ms, cerca del presupuesto de 2500`)
}

titulo('los dos lentos — prueba de que las llamadas son en paralelo')
{
  await Promise.all([salud('vuelos', 'lento'), salud('hospedaje', 'lento')])
  const r = await buscar()
  ok(
    r.vuelos.length === referencia.vuelos && r.hospedaje.length === referencia.hospedaje,
    'los dos responden completo',
  )
  // 1800 ms cada uno: en serie darían ~3600.
  ok(r.ms < 2600, `tarda ${r.ms} ms — el total es el del peor, no la suma`)
  await Promise.all([salud('vuelos', 'ok'), salud('hospedaje', 'ok')])
}

titulo('el admin apaga hospedaje — no se lo llama siquiera')
{
  await salud('hospedaje', 'colgado') // si igual lo llamara, tardaría 2500 ms
  await config('hospedaje', 'inactivo')
  const r = await buscar()
  ok(noDisponible(r, 'hospedaje')?.motivo === 'apagado_por_admin', 'motivo apagado_por_admin')
  ok(r.ms < 800, `responde en ${r.ms} ms: no se llamó al servicio colgado`)
  ok(r.vuelos.length === referencia.vuelos, 'vuelos intacto')
  await config('hospedaje', 'activo')
  await salud('hospedaje', 'ok')
}

titulo('el usuario desactiva hospedaje en sus preferencias')
{
  await preferencias({ vuelos: true, hospedaje: false })
  const r = await buscar()
  ok(
    noDisponible(r, 'hospedaje')?.motivo === 'desactivado_por_usuario',
    'motivo desactivado_por_usuario',
  )
  ok(r.vuelos.length === referencia.vuelos, 'vuelos intacto')
  await preferencias({ vuelos: true, hospedaje: true })
}

titulo('la ruta por vertical respeta el contrato')
{
  await salud('vuelos', 'caido')
  const r = await json(`/api/buscar/vuelos?${CRITERIOS}`)
  ok(r.estado === 503, `HTTP 503 (${r.estado})`)
  ok(r.datos?.estado === 'unavailable', 'cuerpo con estado unavailable')
  ok(typeof r.datos?.motivo === 'string', `motivo presente (${r.datos?.motivo})`)
  ok(typeof r.datos?.generado_en === 'string', 'generado_en presente')
  await salud('vuelos', 'ok')
}

titulo('el catálogo sólo ofrece rutas que existen')
{
  const { datos } = await json('/api/lugares')
  ok(datos.aeropuertos.length > 0, `${datos.aeropuertos.length} aeropuertos en el padrón`)
  ok(datos.origenes.length > 0, `${datos.origenes.length} orígenes con vuelos`)

  const origen = datos.origenes.find((o) => (datos.rutas[o] ?? []).length > 0)
  const alcanzables = new Set(datos.rutas[origen])
  ok(alcanzables.size > 0, `desde ${origen} se llega a ${alcanzables.size} destinos`)

  const destino = datos.rutas[origen][0]
  const r = await json(
    `/api/buscar/vuelos?origen=${origen}&destino=${destino}&ida=2026-10-12&pasajeros=1`,
  )
  ok(r.datos?.items?.length > 0, `${origen} → ${destino} devuelve resultados y no una lista vacía`)

  const inventado = datos.aeropuertos.map((a) => a.iata).find((i) => !alcanzables.has(i) && i !== origen)
  const vacio = await json(
    `/api/buscar/vuelos?origen=${origen}&destino=${inventado}&ida=2026-10-12&pasajeros=1`,
  )
  ok(
    vacio.datos?.items?.length === 0,
    `${origen} → ${inventado} no es ruta real y devuelve vacío, no inventado`,
  )
}

titulo('auditoría del panel de administración')
{
  const { datos } = await json('/api/admin/auditoria')
  ok(Array.isArray(datos) && datos.length > 0, `quedaron ${datos?.length} cambios registrados`)
  ok(datos?.[0]?.quien === 'u-001', 'con el usuario que los hizo')
}

await restaurar()
console.log(fallos === 0 ? '\n✔ todo en verde' : `\n✘ ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
