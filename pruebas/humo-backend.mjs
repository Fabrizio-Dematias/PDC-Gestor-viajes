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

/** Login real (contrato §10): hace falta un token para todo lo que
 *  antes se confiaba a `x-usuario-id` mandado sin verificar. */
async function iniciarSesion(identificador, password) {
  const { datos } = await json('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identificador, password }),
  })
  if (!datos?.token) throw new Error(`no se pudo loguear como ${identificador}`)
  return datos.token
}
const conToken = (token) => (token ? { authorization: `Bearer ${token}` } : {})

const salud = (vertical, estado) =>
  json(`/api/demo/salud/${vertical}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado }),
  })
// `/api/admin/*` exige sesión de admin con permiso `gestion_verticales`.
const config = (vertical, estado, tokenAdmin) =>
  json(`/api/admin/config/${vertical}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...conToken(tokenAdmin) },
    body: JSON.stringify({ estado }),
  })
// `/api/perfil` exige sesión — sin token no hay un perfil de quién editar.
const preferencias = (preferencias, tokenCliente) =>
  json('/api/perfil', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...conToken(tokenCliente) },
    body: JSON.stringify({ preferencias }),
  })

const buscar = async (token) => {
  const t = Date.now()
  const { datos } = await json(`/api/buscar?${CRITERIOS}`, { headers: conToken(token) })
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

async function restaurar(tokenAdmin, tokenCliente) {
  await Promise.all([salud('vuelos', 'ok'), salud('hospedaje', 'ok')])
  await Promise.all([config('vuelos', 'activo', tokenAdmin), config('hospedaje', 'activo', tokenAdmin)])
  await preferencias({ vuelos: true, hospedaje: true }, tokenCliente)
}

// ---------------------------------------------------------------------

try {
  await fetch(`${BASE}/salud`)
} catch {
  console.error(`No hay nadie en ${BASE}. Levantá el backend con: npm run back`)
  process.exit(1)
}

// Login como los dos usuarios semilla (servidor/usuarios/datos.js):
// admin-demo (username admin) para lo que exige gestion_verticales, y
// u-001 (email invitado@demo.com) para lo que sólo exige una sesión.
const tokenAdmin = await iniciarSesion('admin', 'admin1234')
const tokenCliente = await iniciarSesion('invitado@demo.com', 'demo1234')

await restaurar(tokenAdmin, tokenCliente)

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
  await config('hospedaje', 'inactivo', tokenAdmin)
  // Apagado por admin es información pública (contrato §8): ni hace
  // falta sesión para que se respete, alcanza con /api/tenant/config.
  const r = await buscar()
  ok(noDisponible(r, 'hospedaje')?.motivo === 'apagado_por_admin', 'motivo apagado_por_admin')
  ok(r.ms < 800, `responde en ${r.ms} ms: no se llamó al servicio colgado`)
  ok(r.vuelos.length === referencia.vuelos, 'vuelos intacto')
  await config('hospedaje', 'activo', tokenAdmin)
  await salud('hospedaje', 'ok')
}

titulo('el usuario desactiva hospedaje en sus preferencias')
{
  await preferencias({ vuelos: true, hospedaje: false }, tokenCliente)
  // Esta vez la búsqueda tiene que ir logueada: sin sesión el
  // agregador no tiene de quién leer preferencias (invitado = todo
  // activado), así que no vería el cambio recién hecho.
  const r = await buscar(tokenCliente)
  ok(
    noDisponible(r, 'hospedaje')?.motivo === 'desactivado_por_usuario',
    'motivo desactivado_por_usuario',
  )
  ok(r.vuelos.length === referencia.vuelos, 'vuelos intacto')
  await preferencias({ vuelos: true, hospedaje: true }, tokenCliente)
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
  const sinSesion = await json('/api/admin/auditoria')
  ok(sinSesion.estado === 401, `sin sesión, 401 (${sinSesion.estado})`)

  const { datos } = await json('/api/admin/auditoria', { headers: conToken(tokenAdmin) })
  ok(Array.isArray(datos) && datos.length > 0, `quedaron ${datos?.length} cambios registrados`)
  ok(datos?.[0]?.quien === 'admin-demo', 'con el usuario que los hizo')
}

titulo('vertical traslado: mismo contrato que vuelos y hospedaje')
{
  const r = await json(`/api/buscar/traslado?${CRITERIOS}`)
  ok(r.estado === 200, `HTTP 200 (${r.estado})`)
  ok(r.datos?.estado === 'ok', 'estado ok')
  ok(Array.isArray(r.datos?.items) && r.datos.items.length > 0, `devuelve ${r.datos?.items?.length} opciones`)
  ok(
    r.datos.items.every((t) => t.id && t.precio?.moneda && t.capacidad >= 2),
    'las opciones cumplen la forma del contrato §2 y alcanzan para los pasajeros pedidos',
  )
}

titulo('marca blanca: cada agencia tiene su propia config (contrato §8)')
{
  const demo = await json('/api/tenant/config', { headers: { 'x-agencia-id': 'ag-demo' } })
  const sur = await json('/api/tenant/config', { headers: { 'x-agencia-id': 'ag-sur' } })
  ok(demo.estado === 200 && sur.estado === 200, 'las dos agencias resuelven su config')
  ok(
    demo.datos.nombre !== sur.datos.nombre && demo.datos.color_primario !== sur.datos.color_primario,
    `branding distinto (${demo.datos.nombre} / ${sur.datos.nombre})`,
  )
  ok(
    demo.datos.verticales_habilitados.includes('traslado') &&
      !sur.datos.verticales_habilitados.includes('traslado'),
    'ag-sur no ofrece traslado; ag-demo sí — misma config_verticales, agencia_id distinto',
  )
}

titulo('circuit breaker: tres fallos seguidos abren el circuito, sin red al cuarto (contrato §9)')
{
  const buscarComoSur = () =>
    json(`/api/buscar/vuelos?${CRITERIOS}`, { headers: { 'x-agencia-id': 'ag-sur' } })
  await salud('vuelos', 'caido')

  for (let i = 1; i <= 3; i++) {
    const r = await buscarComoSur()
    ok(r.datos?.motivo === 'error', `fallo ${i}/3 registrado (motivo ${r.datos?.motivo})`)
  }
  const cuarto = await buscarComoSur()
  ok(
    cuarto.datos?.motivo === 'circuito_abierto',
    `al cuarto fallo el circuito ya está abierto, sin llamar al servicio (motivo ${cuarto.datos?.motivo})`,
  )

  await salud('vuelos', 'ok')
}

titulo('login real: registro, código, verificación, sesión (contrato §10)')
{
  const email = `prueba-${Date.now()}@test.com`

  const registro = await json('/api/auth/registro', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', nombre: 'Prueba Humo' }),
  })
  ok(registro.estado === 200 && typeof registro.datos?.codigo_demo === 'string', 'registro devuelve un código demo')

  const loginSinVerificar = await json('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identificador: email, password: 'password123' }),
  })
  ok(
    loginSinVerificar.estado === 403 && loginSinVerificar.datos?.motivo === 'email_no_verificado',
    `sin verificar, 403 email_no_verificado (${loginSinVerificar.estado})`,
  )

  const verificar = await json('/api/auth/verificar-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, codigo: registro.datos.codigo_demo }),
  })
  ok(verificar.estado === 200 && typeof verificar.datos?.token === 'string', 'verificar el código loguea directo')

  const perfilNuevo = await json('/api/perfil', { headers: conToken(verificar.datos.token) })
  ok(perfilNuevo.datos?.nombre === 'Prueba Humo', 'el token nuevo sirve para pedir el propio perfil')

  const credencialesMalas = await json('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identificador: email, password: 'una-contraseña-cualquiera' }),
  })
  ok(
    credencialesMalas.estado === 401 && credencialesMalas.datos?.motivo === 'credenciales_invalidas',
    `contraseña incorrecta, 401 credenciales_invalidas (${credencialesMalas.estado})`,
  )
}

await restaurar(tokenAdmin, tokenCliente)
console.log(fallos === 0 ? '\n✔ todo en verde' : `\n✘ ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
