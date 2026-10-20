import { ciudadDeAeropuerto, distanciaKm, localDesdeUtc, utcDesdeLocal } from '../comun/lugares.js'

/**
 * Implementación de `ProveedorDeVuelos` contra la base propia.
 *
 * Es la que se usa por defecto: no depende de internet ni de la cuota de
 * Amadeus, así que la demostración funciona siempre. Ver el contrato de
 * la interfaz en proveedor.js.
 *
 * ## Directos y con escalas
 *
 * La base tiene *rutas directas* reales (OpenFlights): 36 383 pares de
 * aeropuertos. Si sólo se ofrecieran esas, el 99,6 % de las
 * combinaciones origen→destino quedarían "sin vuelos" aunque se pueda
 * viajar sin problema —Córdoba→Madrid no tiene directo, pero hay
 * Córdoba→Buenos Aires y Buenos Aires→Madrid—. Un buscador real arma
 * esas combinaciones, y este también: cuando no alcanza con los
 * directos busca recorridos de una y de dos escalas por la red de rutas
 * reales, y compone itinerarios con horarios que cierran (la conexión
 * espera lo que haga falta, con un mínimo, y se descartan las esperas
 * absurdas).
 *
 * ## Cambio de aeropuerto dentro de una ciudad
 *
 * En Aeroparque sólo despegan vuelos regionales; los intercontinentales
 * salen de Ezeiza, a 35 km. Un viaje Tucumán → Madrid real es Tucumán →
 * Aeroparque, un traslado hasta Ezeiza y Ezeiza → Madrid. Sin modelar ese
 * cambio, Tucumán sólo llegaba a Madrid dando la vuelta por São Paulo (o no
 * llegaba), y lo mismo le pasaba a casi toda ciudad argentina que no sea
 * Buenos Aires: sin él, el 53 % de las búsquedas de una ciudad argentina a
 * las 100 ciudades más conectadas del mundo no daba resultados.
 *
 * Entonces un recorrido puede pasar de un aeropuerto a otro de la *misma
 * ciudad* (`ciudades.json`): cuenta como una escala, exige una espera
 * mínima mayor (4 h, por el traslado y el nuevo check-in) y el tramo sale
 * marcado con `cambio_aeropuerto` para que la pantalla lo diga. Son dos
 * pasajes distintos —el traslado corre por cuenta del pasajero—, y así se
 * muestra.
 *
 * Los husos horarios son los reales de cada aeropuerto: un vuelo que
 * sale de Ezeiza a las 11:45 y dura 13 h 11 no llega "a las 00:56" —
 * llega a las 04:56 de Madrid, que está 4 horas adelante. Antes la
 * llegada se calculaba sumando la duración a la hora de salida sin
 * mirar el huso, y quedaba mal por la diferencia horaria.
 *
 * Qué es simulado y qué no: las rutas y los aeropuertos son reales; los
 * horarios, los precios y las combinaciones son una simulación
 * plausible, y se dicen como tales (README, "De dónde salen los
 * datos").
 */

const MIN = 60_000
const DIA = 86_400_000

/** Espera mínima entre dos vuelos, en minutos: más corta si los dos
 *  están en el mismo país (no hay migraciones). */
const CONEXION_MIN_NACIONAL = 90
const CONEXION_MIN_INTERNACIONAL = 120
/** Cambiar de aeropuerto dentro de la misma ciudad: traslado terrestre,
 *  nuevo check-in y margen para que un retraso no haga perder el vuelo. */
const CONEXION_MIN_CAMBIO_AEROPUERTO = 4 * 60
/** Espera máxima: pasada esta cifra el itinerario no se ofrece. */
const ESPERA_MAX_MIN = 14 * 60

/** Cuántas opciones con escala se ofrecen, según cuántos directos
 *  haya: con directos de sobra alcanza con unas pocas, para que el
 *  usuario compare (más barato pero más largo); sin ellos, la lista
 *  tiene que valerse sola. */
const CON_ESCALA_SI_HAY_DIRECTOS = 3
const CON_ESCALA_SI_HAY_POCOS = 5
const CON_ESCALA_SIN_DIRECTOS = 8
const POCOS_DIRECTOS = 2

/** Descuento de las tarifas con escala respecto de la suma de sus
 *  tramos sueltos — así funcionan las tarifas combinadas: más baratas,
 *  a cambio de tiempo. */
const DESCUENTO_UNA_ESCALA = 0.82
const DESCUENTO_DOS_ESCALAS = 0.72

const redondear = (monto) => Math.round(monto / 1000) * 1000

/** Red de rutas en memoria: sale de la misma tabla, se arma una vez al
 *  arrancar (36 mil pares, un par de decenas de milisegundos) y evita
 *  consultar la base por cada candidato de una búsqueda con escalas. */
function construirGrafo(base) {
  const salidas = new Map() // origen → Map(destino → km)
  const entradas = new Map() // destino → Map(origen → km)
  const pares = base
    .prepare('SELECT origen, destino, MIN(km) AS km FROM itinerarios GROUP BY origen, destino')
    .all()
  for (const { origen, destino, km } of pares) {
    if (!salidas.has(origen)) salidas.set(origen, new Map())
    if (!entradas.has(destino)) entradas.set(destino, new Map())
    salidas.get(origen).set(destino, km)
    entradas.get(destino).set(origen, km)
  }

  /** Los otros aeropuertos con vuelos de la misma ciudad: a esos se
   *  puede pasar por tierra (ver "Cambio de aeropuerto"). */
  const conVuelos = (iata) => salidas.has(iata) || entradas.has(iata)
  const hermanosCache = new Map()
  const hermanos = (iata) => {
    if (!hermanosCache.has(iata)) {
      const ciudad = ciudadDeAeropuerto(iata)
      hermanosCache.set(iata, (ciudad?.aeropuertos ?? []).map((a) => a.iata).filter((i) => i !== iata && conVuelos(i)))
    }
    return hermanosCache.get(iata)
  }
  return { salidas, entradas, hermanos }
}

function fechaLocalMs(fecha, hora) {
  return Date.parse(`${fecha}T${hora}:00Z`)
}

/** Un tramo concreto: la fila de la ruta + a qué hora sale (UTC). */
function tramoDe(fila, salidaUtc) {
  const llegadaUtc = salidaUtc + fila.duracion_min * MIN
  return {
    fila,
    salidaUtc,
    llegadaUtc,
    salidaLocal: localDesdeUtc(fila.origen, salidaUtc),
    llegadaLocal: localDesdeUtc(fila.destino, llegadaUtc),
  }
}

const aIso = (localMs) => new Date(localMs).toISOString()
const idTramo = (t) => `${t.fila.id}-${aIso(t.salidaLocal).slice(0, 10)}`

/** La primera salida de `filas` a partir de `listoUtc`: la de ese mismo
 *  día si todavía alcanza, la del día siguiente si no. */
function siguienteSalida(filas, origen, listoUtc) {
  const dia0 = Math.floor(localDesdeUtc(origen, listoUtc) / DIA) * DIA
  let mejor = null
  for (const fila of filas) {
    const [h, m] = fila.hora_salida.split(':').map(Number)
    for (let d = 0; d <= 2; d++) {
      const salida = utcDesdeLocal(origen, dia0 + d * DIA + (h * 60 + m) * MIN)
      if (salida < listoUtc) continue
      if (!mejor || salida < mejor.salida || (salida === mejor.salida && fila.precio_base < mejor.fila.precio_base)) {
        mejor = { fila, salida }
      }
      break // el primer día válido de esta fila ya es el más temprano
    }
  }
  return mejor
}

function mismoPais(a, b) {
  return ciudadDeAeropuerto(a)?.pais === ciudadDeAeropuerto(b)?.pais
}

/** ¿Los dos aeropuertos son de la misma ciudad (Aeroparque y Ezeiza)? */
function mismaCiudad(a, b) {
  const ciudad = ciudadDeAeropuerto(a)
  return Boolean(ciudad) && ciudad === ciudadDeAeropuerto(b)
}

/**
 * Arma el mejor itinerario que recorre `aeropuertos` (origen, escalas…,
 * destino) saliendo el día `ida`: prueba cada horario del primer tramo y
 * encadena cada tramo siguiente con la primera salida posible respetando
 * la espera mínima. Devuelve el de menor duración total, o `null` si
 * ninguna combinación cierra dentro de la espera máxima.
 */
function componer(aeropuertos, filasPorTramo, ida) {
  let mejor = null
  for (const primera of filasPorTramo[0]) {
    const salida1 = utcDesdeLocal(aeropuertos[0], fechaLocalMs(ida, primera.hora_salida))
    const tramos = [tramoDe(primera, salida1)]
    let cierra = true
    let trasladoPendiente = false

    for (let i = 1; i < filasPorTramo.length; i++) {
      const previo = tramos.at(-1)
      // `null` = no hay vuelo entre estos dos aeropuertos porque son de la
      // misma ciudad: se pasa por tierra y el próximo vuelo sale de otro.
      if (filasPorTramo[i] === null) {
        previo.cambioAeropuerto = true
        trasladoPendiente = true
        continue
      }
      const minimo = trasladoPendiente
        ? CONEXION_MIN_CAMBIO_AEROPUERTO
        : mismoPais(aeropuertos[i - 1], aeropuertos[i + 1])
          ? CONEXION_MIN_NACIONAL
          : CONEXION_MIN_INTERNACIONAL
      trasladoPendiente = false
      const proxima = siguienteSalida(filasPorTramo[i], aeropuertos[i], previo.llegadaUtc + minimo * MIN)
      if (!proxima || proxima.salida - previo.llegadaUtc > ESPERA_MAX_MIN * MIN) {
        cierra = false
        break
      }
      tramos.push(tramoDe(proxima.fila, proxima.salida))
    }
    if (!cierra) continue

    const total = tramos.at(-1).llegadaUtc - tramos[0].salidaUtc
    if (!mejor || total < mejor.total) mejor = { tramos, total }
  }
  return mejor
}

export function crearProveedorFicticio(base) {
  const grafo = construirGrafo(base)
  const consultaRuta = base.prepare(`
    SELECT * FROM itinerarios
    WHERE origen = ? AND destino = ?
    ORDER BY precio_base
  `)

  /** Itinerarios directos de esta ruta, tal como están en la base. */
  function directos(origen, destino, ida, pasajeros) {
    return consultaRuta.all(origen, destino).map((fila) => {
      const t = tramoDe(fila, utcDesdeLocal(origen, fechaLocalMs(ida, fila.hora_salida)))
      return {
        id: idTramo(t),
        aerolinea: fila.aerolinea,
        codigo_aerolinea: fila.codigo_aerolinea,
        origen,
        destino,
        salida: aIso(t.salidaLocal),
        llegada: aIso(t.llegadaLocal),
        duracion_min: fila.duracion_min,
        escalas: fila.escalas,
        precio: { monto: fila.precio_base * pasajeros, moneda: fila.moneda },
      }
    })
  }

  /** Recorridos origen→…→destino por la red real, los de menor
   *  distancia primero. `vias` es la lista de aeropuertos intermedios,
   *  en orden; cuando dos consecutivos son de la misma ciudad (Aeroparque,
   *  Ezeiza) entre ellos hay un cambio de aeropuerto, que no es un vuelo
   *  ni cuenta como escala aparte. */
  function recorridos(origen, destino, kmDirecto) {
    const salidasO = grafo.salidas.get(origen)
    const entradasD = grafo.entradas.get(destino)
    if (!salidasO || !entradasD) return { unaEscala: [], dosEscalas: [] }

    // Tolerancia al rodeo: en un vuelo corto pasar por un hub lejano
    // multiplica la distancia, y eso es normal; en uno largo no.
    const tope = (factor, extra) => Math.max(kmDirecto * factor, kmDirecto + extra)
    const topeUna = tope(1.8, 1200)
    const topeDos = tope(2.2, 2500)

    /** El aeropuerto donde se llega y, si hace falta, los otros de su
     *  ciudad desde donde podría salir el próximo vuelo. */
    const conHermanos = (aeropuerto) => [aeropuerto, ...grafo.hermanos(aeropuerto)]

    const unaEscala = []
    for (const [x, km1] of salidasO) {
      for (const xs of conHermanos(x)) {
        if (xs === destino || xs === origen) continue
        const km2 = entradasD.get(xs)
        if (km2 === undefined) continue
        if (km1 + km2 <= topeUna) unaEscala.push({ vias: xs === x ? [x] : [x, xs], km: km1 + km2 })
      }
    }

    const dosEscalas = []
    for (const [x, km1] of salidasO) {
      if (x === destino) continue
      for (const xs of conHermanos(x)) {
        const salidasX = grafo.salidas.get(xs)
        if (!salidasX) continue
        for (const [y, km2] of salidasX) {
          if (y === origen || y === destino || y === xs) continue
          for (const ys of conHermanos(y)) {
            if (ys === origen || ys === destino || ys === xs) continue
            const km3 = entradasD.get(ys)
            if (km3 === undefined) continue
            if (km1 + km2 + km3 > topeDos) continue
            const vias = [...(xs === x ? [x] : [x, xs]), ...(ys === y ? [y] : [y, ys])]
            dosEscalas.push({ vias, km: km1 + km2 + km3 })
          }
        }
      }
    }

    const porKm = (a, b) => a.km - b.km
    return { unaEscala: unaEscala.sort(porKm), dosEscalas: dosEscalas.sort(porKm) }
  }

  /** Itinerario compuesto → ítem del contrato (con `segmentos`). */
  function conEscalas(origen, destino, vias, ida, pasajeros) {
    const aeropuertos = [origen, ...vias, destino]
    // Entre dos aeropuertos de la misma ciudad sin vuelo propio hay un
    // cambio por tierra (`null`); cualquier otro tramo sin vuelos es un
    // recorrido que no existe.
    const filasPorTramo = aeropuertos.slice(0, -1).map((a, i) => {
      const filas = consultaRuta.all(a, aeropuertos[i + 1])
      return filas.length === 0 && mismaCiudad(a, aeropuertos[i + 1]) ? null : filas
    })
    if (filasPorTramo.some((f) => f !== null && f.length === 0)) return null
    if (filasPorTramo[0] === null || filasPorTramo.at(-1) === null) return null

    const armado = componer(aeropuertos, filasPorTramo, ida)
    if (!armado) return null
    const { tramos, total } = armado

    // Una escala por cada vuelo que sigue a otro: un cambio de aeropuerto
    // no suma una más, es parte de la misma escala.
    const escalasDeRecorrido = tramos.length - 1
    const descuento = escalasDeRecorrido === 1 ? DESCUENTO_UNA_ESCALA : DESCUENTO_DOS_ESCALAS
    const porPasajero = redondear(tramos.reduce((s, t) => s + t.fila.precio_base, 0) * descuento)

    const aerolineas = [...new Map(tramos.map((t) => [t.fila.codigo_aerolinea, t.fila.aerolinea])).entries()]
    const primero = tramos[0]
    const ultimo = tramos.at(-1)

    return {
      id: tramos.map(idTramo).join('~'),
      // Con más de una aerolínea se nombran todas; el código es el del
      // primer tramo, que es el que vende el pasaje.
      aerolinea: aerolineas.map(([, nombre]) => nombre).join(' + '),
      codigo_aerolinea: primero.fila.codigo_aerolinea,
      origen,
      destino,
      salida: aIso(primero.salidaLocal),
      llegada: aIso(ultimo.llegadaLocal),
      duracion_min: Math.round(total / MIN),
      escalas: tramos.reduce((s, t) => s + t.fila.escalas, 0) + escalasDeRecorrido,
      precio: { monto: porPasajero * pasajeros, moneda: primero.fila.moneda },
      segmentos: tramos.map((t, i) => ({
        origen: t.fila.origen,
        destino: t.fila.destino,
        salida: aIso(t.salidaLocal),
        llegada: aIso(t.llegadaLocal),
        duracion_min: t.fila.duracion_min,
        aerolinea: t.fila.aerolinea,
        codigo_aerolinea: t.fila.codigo_aerolinea,
        // Cuánto se espera en el aeropuerto de llegada de este tramo
        // hasta el próximo vuelo; el último tramo no espera a nadie.
        ...(i < tramos.length - 1
          ? { espera_min: Math.round((tramos[i + 1].salidaUtc - t.llegadaUtc) / MIN) }
          : {}),
        // El próximo vuelo sale de otro aeropuerto de la misma ciudad.
        ...(t.cambioAeropuerto ? { cambio_aeropuerto: true } : {}),
      })),
    }
  }

  return {
    nombre: 'ficticio',

    /** Aeropuertos de un lugar entre los que hay que buscar: todos los
     *  de la ciudad que tienen vuelos. */
    expandir(lugar) {
      return lugar.aeropuertos
    },

    /** ¿Opera algún vuelo en este aeropuerto? */
    tieneVuelos(iata) {
      return grafo.salidas.has(iata) || grafo.entradas.has(iata)
    },

    async buscar({ origen, destino, ida, pasajeros }) {
      const itinerarios = directos(origen, destino, ida, pasajeros)

      const kmDirecto = distanciaKm(origen, destino) ?? 20_000
      const { unaEscala, dosEscalas } = recorridos(origen, destino, kmDirecto)

      const cupo =
        itinerarios.length === 0
          ? CON_ESCALA_SIN_DIRECTOS
          : itinerarios.length <= POCOS_DIRECTOS
            ? CON_ESCALA_SI_HAY_POCOS
            : CON_ESCALA_SI_HAY_DIRECTOS

      const compuestos = []
      for (const { vias } of unaEscala) {
        if (compuestos.length >= cupo) break
        const item = conEscalas(origen, destino, vias, ida, pasajeros)
        if (item) compuestos.push(item)
      }
      // Dos escalas sólo si lo anterior no alcanza: es un viaje largo y
      // pesado, no algo para mostrar si ya hay mejores opciones.
      if (itinerarios.length + compuestos.length < 2) {
        for (const { vias } of dosEscalas) {
          if (compuestos.length >= CON_ESCALA_SIN_DIRECTOS) break
          const item = conEscalas(origen, destino, vias, ida, pasajeros)
          if (item) compuestos.push(item)
        }
      }

      return [...itinerarios, ...compuestos]
    },
  }
}
