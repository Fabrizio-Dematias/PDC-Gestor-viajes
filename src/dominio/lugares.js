/**
 * Catálogo de lugares: **ciudades**, cada una con sus aeropuertos.
 *
 * Quien viaja piensa en ciudades; los aeropuertos son un detalle que se
 * decide después. Antes el buscador trabajaba con aeropuertos sueltos, y
 * Buenos Aires aparecía dos veces con el mismo nombre (Ezeiza y
 * Aeroparque): quien elegía el primero —Aeroparque— no encontraba Madrid
 * porque de ahí no sale ningún vuelo intercontinental. Ahora se elige
 * "Buenos Aires" (que busca en los dos) o, si se quiere, uno en
 * particular.
 *
 * Un *lugar* se identifica por un código de tres letras que puede ser el
 * de una ciudad (`BUE`) o el de un aeropuerto (`EZE`); para casi todas
 * las ciudades —las de un solo aeropuerto— son el mismo. Es lo que viaja
 * en `origen` y `destino` (docs/contrato-agregador.md §2).
 *
 * Con backend el catálogo lo sirve `GET /api/v1/lugares`. Esta lista
 * corta sólo existe para que el front se pueda usar solo (modo
 * simulado) o si el servicio de vuelos no está.
 */
const SIMULADAS = [
  ['BUE', 'Buenos Aires', 'Argentina', [['EZE', 'Ezeiza'], ['AEP', 'Aeroparque']]],
  ['COR', 'Córdoba', 'Argentina', [['COR', 'Ingeniero Taravella']]],
  ['MDZ', 'Mendoza', 'Argentina', [['MDZ', 'El Plumerillo']]],
  ['ROS', 'Rosario', 'Argentina', [['ROS', 'Islas Malvinas']]],
  ['BRC', 'Bariloche', 'Argentina', [['BRC', 'Teniente Candelaria']]],
  ['MAD', 'Madrid', 'España', [['MAD', 'Barajas']]],
  ['BCN', 'Barcelona', 'España', [['BCN', 'El Prat']]],
  ['ROM', 'Roma', 'Italia', [['FCO', 'Fiumicino'], ['CIA', 'Ciampino']]],
  ['PAR', 'París', 'Francia', [['CDG', 'Charles de Gaulle'], ['ORY', 'Orly']]],
  ['LIS', 'Lisboa', 'Portugal', [['LIS', 'Humberto Delgado']]],
  ['MIA', 'Miami', 'Estados Unidos', [['MIA', 'Miami Internacional']]],
  ['NYC', 'Nueva York', 'Estados Unidos', [['JFK', 'John F. Kennedy'], ['EWR', 'Newark Liberty'], ['LGA', 'LaGuardia']]],
  ['MEX', 'Ciudad de México', 'México', [['MEX', 'Benito Juárez']]],
  ['PUJ', 'Punta Cana', 'República Dominicana', [['PUJ', 'Punta Cana']]],
  ['SCL', 'Santiago', 'Chile', [['SCL', 'Arturo Merino Benítez']]],
  ['SAO', 'São Paulo', 'Brasil', [['GRU', 'Guarulhos'], ['CGH', 'Congonhas']]],
  ['LIM', 'Lima', 'Perú', [['LIM', 'Jorge Chávez']]],
]

export function crearCatalogo(ciudades) {
  const porCodigo = new Map()
  for (const c of ciudades) porCodigo.set(c.codigo, { tipo: 'ciudad', ciudad: c })
  for (const c of ciudades) {
    for (const a of c.aeropuertos) {
      if (!porCodigo.has(a.iata)) porCodigo.set(a.iata, { tipo: 'aeropuerto', ciudad: c, aeropuerto: a })
    }
  }
  return { ciudades, porCodigo }
}

export const CATALOGO_SIMULADO = crearCatalogo(
  SIMULADAS.map(([codigo, nombre, pais, aeropuertos], i) => ({
    codigo,
    nombre,
    pais,
    trafico: 1000 - i,
    vuelos: true,
    aeropuertos: aeropuertos.map(([iata, nombre]) => ({ iata, nombre, vuelos: true })),
  })),
)

/** `{ tipo, ciudad, aeropuerto? }` del código, o `undefined`. */
export function buscarLugar(catalogo, codigo) {
  return catalogo.porCodigo.get(codigo)
}

/** Sin acentos y en minúscula: quien escribe "cordoba" busca "Córdoba". */
export function normalizar(texto) {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const empiezaAlguna = (frase, q) =>
  frase.split(/[\s·,\-/.']+/).some((palabra) => palabra.startsWith(q))

/**
 * Puntaje de una coincidencia: cuanto más bajo, más arriba aparece.
 *
 * El orden importa más que el filtro. Escribir "cor" tiene que traer
 * Córdoba antes que Comodoro Rivadavia, y "esp" tiene que traer las
 * ciudades de España aunque ninguna se llame así. A igualdad de
 * puntaje decide el tráfico: "san" no puede empezar por una ciudad con
 * dos vuelos por semana.
 */
/** Los textos de cada ciudad, ya normalizados. Con ~5800 ciudades,
 *  normalizar (descomponer y quitar acentos) en cada tecla eran ~25 000
 *  llamadas por pulsación; se hace una vez por ciudad y se recuerda. */
const normalizadas = new WeakMap()
function textosDe(ciudad) {
  let t = normalizadas.get(ciudad)
  if (!t) {
    t = {
      nombre: normalizar(ciudad.nombre),
      pais: normalizar(ciudad.pais),
      codigo: normalizar(ciudad.codigo),
      iatas: ciudad.aeropuertos.map((a) => normalizar(a.iata)),
      nombresAeropuerto: ciudad.aeropuertos.map((a) => normalizar(a.nombre)),
    }
    normalizadas.set(ciudad, t)
  }
  return t
}

function puntaje(ciudad, q) {
  const { nombre, pais, codigo, iatas, nombresAeropuerto } = textosDe(ciudad)

  if (codigo === q || iatas.includes(q)) return 0
  // Prefijo del código: quien escribe "ez" busca Ezeiza, no una ciudad
  // cuyo nombre contiene esas dos letras en el medio.
  if (codigo.startsWith(q) || iatas.some((i) => i.startsWith(q))) return 0.5
  if (nombre.startsWith(q)) return 1
  if (pais.startsWith(q)) return 2
  if (empiezaAlguna(nombre, q)) return 3
  if (nombresAeropuerto.some((n) => empiezaAlguna(n, q))) return 4
  if (nombre.includes(q)) return 5
  if (pais.includes(q)) return 6
  if (nombresAeropuerto.some((n) => n.includes(q))) return 7
  return null
}

/**
 * Busca lugares por ciudad, país, aeropuerto o código.
 *
 * Devuelve **opciones** listas para mostrar, agrupadas por ciudad: la
 * ciudad primero ("Buenos Aires — todos los aeropuertos") y, si tiene
 * varios aeropuertos útiles, cada uno debajo. Si lo escrito es el
 * código exacto de un aeropuerto ("eze"), ese aeropuerto va antes que su
 * ciudad: quien tipea un código sabe lo que quiere.
 *
 * `soloVuelos` deja afuera las ciudades y aeropuertos sin vuelos (la
 * pestaña de vuelos no tiene que ofrecer Torrejón); los que coinciden
 * con lo escrito pero quedan afuera se cuentan en `descartadas`, para
 * poder decirle al usuario por qué no los ve en vez de esconderlos sin
 * explicación. Hospedaje y traslado no filtran y no muestran
 * aeropuertos: se aloja uno en la ciudad.
 */
export function buscarLugares(catalogo, consulta, { soloVuelos = false } = {}) {
  const q = normalizar(consulta)
  const grupos = []
  let descartadas = 0

  for (const ciudad of catalogo.ciudades) {
    const utiles = soloVuelos ? ciudad.aeropuertos.filter((a) => a.vuelos) : ciudad.aeropuertos
    const p = q ? puntaje(ciudad, q) : 8
    if (p === null) continue
    if (soloVuelos && utiles.length === 0) {
      descartadas++
      continue
    }
    grupos.push({ ciudad, aeropuertos: utiles, p })
  }

  grupos.sort(
    (x, y) =>
      x.p - y.p ||
      (y.ciudad.trafico ?? 0) - (x.ciudad.trafico ?? 0) ||
      x.ciudad.nombre.localeCompare(y.ciudad.nombre),
  )

  const conAeropuertos = soloVuelos
  const coincidencias = []
  for (const { ciudad, aeropuertos, p } of grupos) {
    const opcionCiudad = { tipo: 'ciudad', codigo: ciudad.codigo, ciudad, aeropuertos, _p: p }
    const varios = conAeropuertos && aeropuertos.length > 1
    if (!varios) {
      coincidencias.push(opcionCiudad)
      continue
    }
    const delAeropuerto = aeropuertos.map((aeropuerto) => ({
      tipo: 'aeropuerto',
      codigo: aeropuerto.iata,
      ciudad,
      aeropuerto,
      _p: p,
    }))
    const exacto = q ? delAeropuerto.find((o) => normalizar(o.codigo) === q) : null
    if (exacto) {
      coincidencias.push(exacto, opcionCiudad, ...delAeropuerto.filter((o) => o !== exacto))
    } else {
      coincidencias.push(opcionCiudad, ...delAeropuerto)
    }
  }

  return { coincidencias, descartadas }
}

/** "Madrid, España" — o "Buenos Aires" sin país, que es de acá — y, si el
 *  lugar es un aeropuerto de una ciudad con varios, cuál: "Buenos Aires
 *  (Ezeiza)". */
export function etiquetaDe(catalogo, codigo) {
  const lugar = buscarLugar(catalogo, codigo)
  if (!lugar) return codigo
  const { ciudad, aeropuerto, tipo } = lugar
  const base = ciudad.pais && ciudad.pais !== 'Argentina' ? `${ciudad.nombre}, ${ciudad.pais}` : ciudad.nombre
  const variosAeropuertos = ciudad.aeropuertos.filter((a) => a.vuelos).length > 1
  return tipo === 'aeropuerto' && variosAeropuertos ? `${base} (${aeropuerto.nombre})` : base
}

/** El nombre corto del aeropuerto ("Aeroparque") o, si no se conoce, su
 *  código. Sirve para decir "llegás a Aeroparque y salís de Ezeiza" sin
 *  repetir la ciudad en cada mitad de la frase. */
export function nombreDeAeropuerto(catalogo, iata) {
  return buscarLugar(catalogo, iata)?.ciudad.aeropuertos.find((a) => a.iata === iata)?.nombre ?? iata
}

/** ¿Los dos códigos son la misma ciudad? Un viaje de Buenos Aires a
 *  Ezeiza no es un viaje: el buscador no lo deja armar. */
export function mismaCiudad(catalogo, a, b) {
  if (!a || !b) return false
  const x = buscarLugar(catalogo, a)
  const y = buscarLugar(catalogo, b)
  return Boolean(x && y && x.ciudad.codigo === y.ciudad.codigo)
}
