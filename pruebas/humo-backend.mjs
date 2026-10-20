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

/** Fechas relativas a hoy: con fechas fijas la prueba se vuelve vieja
 *  sola (una búsqueda en el pasado no tiene sentido y hospedaje exige
 *  que la salida sea posterior a la entrada). */
const enDias = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const IDA = enDias(30)
const VUELTA = enDias(40)
// BUE (Buenos Aires, Ezeiza y Aeroparque) → MAD: la ruta de referencia del proyecto.
const CRITERIOS = `origen=BUE&destino=MAD&ida=${IDA}&vuelta=${VUELTA}&pasajeros=2`

let fallos = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${msg}`)
  if (!cond) fallos++
}
const titulo = (t) => console.log(`\n${t}`)

const json = async (ruta, opciones) => {
  const res = await fetch(`${BASE}${ruta}`, opciones)
  return { estado: res.status, datos: await res.json().catch(() => null), cabeceras: res.headers }
}

/** Login real (contrato §10): hace falta un token para todo lo que
 *  antes se confiaba a `x-usuario-id` mandado sin verificar. */
async function iniciarSesion(identificador, password) {
  const { datos } = await json('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identificador, password }),
  })
  if (!datos?.token) throw new Error(`no se pudo loguear como ${identificador}`)
  return datos.token
}
const conToken = (token) => (token ? { authorization: `Bearer ${token}` } : {})

const salud = (vertical, estado) =>
  json(`/api/v1/demo/salud/${vertical}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado }),
  })
// `/api/admin/*` exige sesión de admin con permiso `gestion_verticales`.
const config = (vertical, estado, tokenAdmin) =>
  json(`/api/v1/admin/config/${vertical}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...conToken(tokenAdmin) },
    body: JSON.stringify({ estado }),
  })
// `/api/perfil` exige sesión — sin token no hay un perfil de quién editar.
const preferencias = (preferencias, tokenCliente) =>
  json('/api/v1/perfil', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...conToken(tokenCliente) },
    body: JSON.stringify({ preferencias }),
  })

const buscar = async (token) => {
  const t = Date.now()
  const { datos } = await json(`/api/v1/buscar?${CRITERIOS}`, { headers: conToken(token) })
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
  // La primera búsqueda después de tocar la configuración paga la lectura
  // de Postgres (con Supabase, entre 0,25 y 1,5 s); la siguiente ya la
  // tiene en la caché de contexto del agregador. Se mide la segunda: lo que
  // interesa acá es que las llamadas a los verticales sean en paralelo.
  await buscar()
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
  const r = await json(`/api/v1/buscar/vuelos?${CRITERIOS}`)
  ok(r.estado === 503, `HTTP 503 (${r.estado})`)
  ok(r.datos?.estado === 'unavailable', 'cuerpo con estado unavailable')
  ok(typeof r.datos?.motivo === 'string', `motivo presente (${r.datos?.motivo})`)
  ok(typeof r.datos?.generado_en === 'string', 'generado_en presente')
  await salud('vuelos', 'ok')
}

titulo('lugares: ciudades con sus aeropuertos, no aeropuertos sueltos (contrato §13)')
{
  const { estado, datos, cabeceras } = await json('/api/v1/lugares')
  ok(estado === 200 && Array.isArray(datos?.ciudades), `${datos?.ciudades?.length} ciudades en el catálogo`)
  const bue = datos.ciudades.find((c) => c.codigo === 'BUE')
  ok(bue?.aeropuertos.map((a) => a.iata).sort().join() === 'AEP,EZE', 'Buenos Aires agrupa Ezeiza y Aeroparque')
  ok(
    datos.ciudades.filter((c) => c.nombre === 'Buenos Aires' && c.pais === 'Argentina').length === 1,
    'hay una sola Buenos Aires argentina (antes eran dos entradas iguales)',
  )
  const madrid = datos.ciudades.find((c) => c.codigo === 'MAD')
  ok(madrid?.aeropuertos.filter((a) => a.vuelos).length === 1, 'Madrid ofrece sólo el aeropuerto con vuelos (Torrejón y Cuatro Vientos no tienen)')
  ok(!cabeceras.get('deprecation'), '/api/v1/lugares no está deprecada')

  // La forma anterior (v0) sigue respondiendo, avisando que está deprecada.
  const v0 = await json('/api/lugares')
  ok(v0.estado === 200 && v0.datos?.rutas?.EZE?.includes('MAD'), '/api/lugares (v0) sigue devolviendo aeropuertos y rutas directas')
  ok(v0.cabeceras.get('deprecation') === 'true', 'y avisa Deprecation: true')
  ok(v0.cabeceras.get('link')?.includes('/api/v1/lugares'), 'con un Link rel="successor-version" a la nueva')
}

titulo('rutas: cualquier par con camino se puede buscar, con o sin vuelo directo')
{
  const vuelos = (o, d) => json(`/api/v1/buscar/vuelos?origen=${o}&destino=${d}&ida=${IDA}&pasajeros=1`)

  const bueMad = await vuelos('BUE', 'MAD')
  const itemsBue = bueMad.datos.items
  ok(itemsBue.some((v) => v.escalas === 0), `BUE → MAD tiene vuelos directos (${itemsBue.filter((v) => v.escalas === 0).length})`)
  ok(itemsBue.some((v) => v.escalas > 0 && v.segmentos?.length === v.escalas + 1), 'y también opciones con escala, con sus segmentos')
  ok(itemsBue.some((v) => v.origen === 'AEP'), 'incluye salidas desde Aeroparque, no sólo Ezeiza')

  // El caso que originó el cambio: de Aeroparque no sale ningún vuelo
  // directo a Madrid, pero se llega con escala.
  const aepMad = await vuelos('AEP', 'MAD')
  ok(aepMad.datos.items.length > 0, `AEP → MAD devuelve ${aepMad.datos.items.length} itinerarios (antes: ninguno)`)
  ok(aepMad.datos.items.every((v) => v.escalas >= 1), 'todos con escala, porque no existe el directo')

  // Sin directo, cualquier combinación de la red: Córdoba → Madrid.
  const corMad = await vuelos('COR', 'MAD')
  ok(corMad.datos.items.length > 0 && corMad.datos.items.every((v) => v.escalas >= 1), `COR → MAD sin directo, con escalas (${corMad.datos.items.length})`)

  // Tucumán sólo conecta con Aeroparque, y de Aeroparque no sale ningún
  // intercontinental: el viaje real es Aeroparque → traslado → Ezeiza →
  // Madrid. Es un cambio de aeropuerto dentro de la misma ciudad, que
  // cuenta como una sola escala y se avisa en el segmento.
  const tucMad = await vuelos('TUC', 'MAD')
  const conCambio = tucMad.datos.items.find((v) => v.escalas === 1 && v.segmentos?.some((s) => s.cambio_aeropuerto))
  ok(conCambio, `TUC → MAD: una escala en Buenos Aires cambiando de aeropuerto (${conCambio?.segmentos.map((s) => `${s.origen}→${s.destino}`).join(' · ')})`)
  ok(conCambio?.segmentos[0].espera_min >= 240, `con al menos 4 h de espera por el traslado y el nuevo check-in (${conCambio?.segmentos[0].espera_min} min)`)
  ok(tucMad.datos.items.some((v) => v.escalas === 2), 'y también opciones con dos escalas')

  // Ida y vuelta: la vuelta es otra búsqueda, destino → origen.
  const madBue = await vuelos('MAD', 'BUE')
  ok(madBue.datos.items.length > 0, `la vuelta MAD → BUE también tiene resultados (${madBue.datos.items.length})`)

  // Lo que de verdad no tiene camino (Tucumán → Sochi, a más de 3 tramos)
  // devuelve vacío: ni se inventa un vuelo ni es un error.
  const sinCamino = await vuelos('TUC', 'AER')
  ok(sinCamino.estado === 200 && sinCamino.datos.items.length === 0, 'un recorrido sin camino devuelve vacío, no inventado')

  // Una ciudad de un solo aeropuerto se busca igual por ciudad o por aeropuerto.
  const porCiudad = await vuelos('COR', 'BUE')
  const porAeropuerto = await vuelos('COR', 'EZE')
  ok(porCiudad.datos.items.length >= porAeropuerto.datos.items.length && porAeropuerto.datos.items.length > 0, 'COR → EZE (aeropuerto) y COR → BUE (ciudad) responden')

  // Hospedaje y traslado: por ciudad, sin importar el aeropuerto.
  const hosp = (d) => json(`/api/v1/buscar/hospedaje?destino=${d}&ida=${IDA}&vuelta=${VUELTA}&pasajeros=2`)
  const porRoma = await hosp('ROM')
  const porFiumicino = await hosp('FCO')
  ok(porRoma.datos.items.length > 0 && porRoma.datos.items.every((h) => h.ciudad === 'Roma'), `hospedaje en Roma por código de ciudad (${porRoma.datos.items.length})`)
  ok(
    JSON.stringify(porRoma.datos.items.map((h) => h.id)) === JSON.stringify(porFiumicino.datos.items.map((h) => h.id)),
    'ROM y FCO devuelven los mismos alojamientos: se aloja en la ciudad, no en el aeropuerto',
  )
  const noAeropuertoSinVuelos = await hosp('TOJ') // Torrejón: sin vuelos, pero está en Madrid
  ok(noAeropuertoSinVuelos.datos.items.length > 0 && noAeropuertoSinVuelos.datos.items[0].ciudad === 'Madrid', 'hospedaje en Torrejón resuelve a Madrid')
}

titulo('búsquedas inválidas: se rechazan con 400 y no cuentan como un servicio caído')
{
  const mismo = await json(`/api/v1/buscar/vuelos?origen=BUE&destino=EZE&ida=${IDA}`)
  ok(mismo.estado === 400 && mismo.datos?.motivo === 'mismo_lugar', `Buenos Aires → Ezeiza: 400 mismo_lugar (${mismo.estado})`)
  const raro = await json(`/api/v1/buscar/vuelos?origen=ZZZ&destino=MAD&ida=${IDA}`)
  ok(raro.estado === 400 && raro.datos?.motivo === 'lugar_desconocido', `un origen que no existe: 400 lugar_desconocido (${raro.estado})`)

  // Si contaran como fallos, tres búsquedas mal armadas abrirían el
  // circuito y dejarían a todos sin vuelos durante 30 s.
  for (let i = 0; i < 4; i++) await json(`/api/v1/buscar/vuelos?origen=BUE&destino=EZE&ida=${IDA}`, { headers: { 'x-agencia-id': 'ag-demo' } })
  const despues = await json(`/api/v1/buscar/vuelos?origen=BUE&destino=MAD&ida=${IDA}&pasajeros=1`)
  ok(despues.estado === 200 && despues.datos.items.length > 0, 'después de varias búsquedas inválidas, la siguiente válida funciona (circuito cerrado)')
}

titulo('horas: la llegada respeta el huso horario del aeropuerto de destino')
{
  // En diciembre Madrid va 4 horas adelante de Buenos Aires: un vuelo de
  // 13 h 11 m "llega" a las 17 h 11 m del reloj de Madrid. Antes la llegada
  // se calculaba sumando la duración sin mirar el huso y quedaba 4 h corrida.
  const dic = `${new Date().getUTCFullYear() + (new Date().getUTCMonth() > 11 ? 1 : 0)}-12-15`
  const r = await json(`/api/v1/buscar/vuelos?origen=EZE&destino=MAD&ida=${dic}&pasajeros=1`)
  const directo = r.datos.items.find((v) => v.escalas === 0)
  const aparente = (Date.parse(directo.llegada) - Date.parse(directo.salida)) / 60_000
  ok(aparente === directo.duracion_min + 240, `llegada − salida = duración + 4 h de huso (${aparente} = ${directo.duracion_min} + 240)`)
  ok(directo.salida.endsWith('Z') && directo.salida.startsWith(dic), 'las horas son reloj del aeropuerto, escritas con Z (contrato §2)')
}

titulo('auditoría del panel de administración')
{
  const sinSesion = await json('/api/v1/admin/auditoria')
  ok(sinSesion.estado === 401, `sin sesión, 401 (${sinSesion.estado})`)

  const { datos } = await json('/api/v1/admin/auditoria', { headers: conToken(tokenAdmin) })
  ok(Array.isArray(datos) && datos.length > 0, `quedaron ${datos?.length} cambios registrados`)
  ok(datos?.[0]?.quien === 'admin-demo', 'con el usuario que los hizo')
}

titulo('vertical traslado: mismo contrato que vuelos y hospedaje')
{
  const r = await json(`/api/v1/buscar/traslado?${CRITERIOS}`)
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
  const demo = await json('/api/v1/tenant/config', { headers: { 'x-agencia-id': 'ag-demo' } })
  const sur = await json('/api/v1/tenant/config', { headers: { 'x-agencia-id': 'ag-sur' } })
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
    json(`/api/v1/buscar/vuelos?${CRITERIOS}`, { headers: { 'x-agencia-id': 'ag-sur' } })
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
  // Un email fijo y no uno nuevo por corrida: cada corrida dejaba un
  // usuario de más en la base compartida (Supabase), sin forma de
  // borrarlo desde acá. La primera vez se prueba el alta completa; las
  // siguientes, que la cuenta ya existente entra y que el alta repetida
  // se rechaza.
  const email = 'prueba-humo@test.com'
  const post = (ruta, cuerpo) =>
    json(ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })

  const registro = await post('/api/v1/auth/registro', { email, password: 'password123', nombre: 'Prueba Humo' })
  let token
  if (registro.estado === 200) {
    ok(typeof registro.datos?.codigo_demo === 'string', 'registro devuelve un código demo')

    const loginSinVerificar = await post('/api/v1/auth/login', { identificador: email, password: 'password123' })
    ok(
      loginSinVerificar.estado === 403 && loginSinVerificar.datos?.motivo === 'email_no_verificado',
      `sin verificar, 403 email_no_verificado (${loginSinVerificar.estado})`,
    )

    const verificar = await post('/api/v1/auth/verificar-email', { email, codigo: registro.datos.codigo_demo })
    ok(verificar.estado === 200 && typeof verificar.datos?.token === 'string', 'verificar el código loguea directo')
    token = verificar.datos.token
  } else {
    ok(registro.estado === 409, `la cuenta de prueba ya existía: el alta repetida se rechaza con 409 (${registro.estado})`)
    const login = await post('/api/v1/auth/login', { identificador: email, password: 'password123' })
    ok(login.estado === 200 && typeof login.datos?.token === 'string', 'y esa cuenta (ya verificada) inicia sesión')
    token = login.datos?.token
  }

  const perfilNuevo = await json('/api/v1/perfil', { headers: conToken(token) })
  ok(perfilNuevo.datos?.nombre === 'Prueba Humo', 'el token sirve para pedir el propio perfil')

  const credencialesMalas = await post('/api/v1/auth/login', { identificador: email, password: 'una-contraseña-cualquiera' })
  ok(
    credencialesMalas.estado === 401 && credencialesMalas.datos?.motivo === 'credenciales_invalidas',
    `contraseña incorrecta, 401 credenciales_invalidas (${credencialesMalas.estado})`,
  )
}

await restaurar(tokenAdmin, tokenCliente)
console.log(fallos === 0 ? '\n✔ todo en verde' : `\n✘ ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
