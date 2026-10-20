import { CONFIG } from '../comun/config.js'
import { crearServicio, ErrorHttp } from '../comun/http.js'
import { pedirJson } from '../comun/pedir.js'

/**
 * Registro de servicios (Módulo 4, "descubrimiento de servicios").
 *
 * Hasta ahora cada servicio conocía la dirección de los demás por una
 * variable de entorno fija (`URL_VUELOS=http://localhost:4001`). Eso
 * alcanza con una instancia de cada uno, pero no cuando los servicios
 * "aparecen, se mueven y desaparecen": si se levanta una segunda
 * instancia de vuelos, o una se cae, hay que cambiar configuración y
 * reiniciar a quien la usa. Este servicio resuelve esa pregunta —*¿quién
 * está vivo y dónde?*— con el mismo esquema de Consul, en chico:
 *
 *   1. **Registro.** Cada servicio, al arrancar, se anota acá con su
 *      nombre, su dirección y un id de instancia, y lo repite cada pocos
 *      segundos (`PUT`, que hace de latido).
 *   2. **Health checks.** Este servicio pregunta periódicamente a cada
 *      instancia `GET /salud/ready` y la marca `pasando` o `critico`. No
 *      alcanza con que esté *registrada*: registrarse sólo dice que
 *      existe y cuál es su dirección, no que ya esté lista para recibir
 *      tráfico (puede seguir cargando datos o esperando a su base).
 *   3. **Descubrimiento del lado del cliente.** Quien necesita llamar a
 *      un servicio le pide la lista de instancias *sanas* y elige él a
 *      cuál (`servidor/comun/descubrimiento.js`: reparte por turnos). Es
 *      el patrón "client-side discovery" de Netflix Eureka; el
 *      "server-side" sería un balanceador fijo adelante, que es lo que
 *      hace Docker Compose o Kubernetes con el nombre del servicio.
 *
 * Una instancia desaparece de la lista de tres maneras: se da de baja
 * (`DELETE`, al cerrarse ordenadamente), deja de latir (se murió sin
 * avisar: pasa el TTL) o lleva demasiado tiempo en `critico`.
 *
 * ## Qué pasa si el registro se cae
 *
 * Es un punto único de falla —Consul y etcd lo evitan replicándose con
 * Raft, algo que acá no se justifica— y por eso **nadie depende de él
 * para funcionar**: los clientes guardan la última lista y, si el
 * registro no responde, vuelven a las direcciones fijas de `config.js`.
 * Perder el registro hace perder el descubrimiento dinámico, no el
 * sistema. Al volver, los servicios se re-anotan solos con su próximo
 * latido (el registro no guarda nada en disco).
 */

const TTL_MS = Number(process.env.REGISTRO_TTL_MS ?? 10_000)
const CHEQUEO_MS = Number(process.env.REGISTRO_CHEQUEO_MS ?? 2_000)
const CHEQUEO_TIMEOUT_MS = 1_500
/** Una instancia que está en `critico` desde hace más que esto se da de baja. */
const BAJA_CRITICO_MS = Number(process.env.REGISTRO_BAJA_CRITICO_MS ?? 60_000)

/** nombre → Map(id → instancia). Un nombre sigue existiendo aunque se
 *  quede sin instancias: "conocido y sin nadie sano" es distinto de "no
 *  lo conozco", y el cliente tiene que poder distinguirlos. */
const servicios = new Map()

const URL_VALIDA = /^https?:\/\/[^\s/]+(:\d+)?\/?$/

function instanciasDe(nombre) {
  return [...(servicios.get(nombre)?.values() ?? [])]
}

function publica(i) {
  return {
    id: i.id,
    url: i.url,
    version: i.version,
    estado: i.estado,
    detalle: i.detalle,
    latencia_ms: i.latencia_ms,
    registrada_en: i.registrada_en,
    ultimo_latido: i.ultimo_latido,
    ultimo_chequeo: i.ultimo_chequeo,
  }
}

function cambiarEstado(i, estado, detalle) {
  if (i.estado !== estado) {
    console.log(`[registro] ${i.nombre}/${i.id}: ${i.estado} → ${estado}${detalle ? ` (${detalle})` : ''}`)
    i.critico_desde = estado === 'critico' ? Date.now() : null
  }
  i.estado = estado
  i.detalle = detalle
}

/** `GET /salud/ready` de la instancia: 200 es `pasando`; cualquier otra
 *  cosa —503, timeout, conexión rechazada— es `critico`. */
async function chequear(i) {
  const desde = Date.now()
  try {
    const { ok, estado, datos } = await pedirJson(`${i.url}/salud/ready`, { timeoutMs: CHEQUEO_TIMEOUT_MS })
    i.latencia_ms = Date.now() - desde
    i.ultimo_chequeo = new Date().toISOString()
    if (ok) cambiarEstado(i, 'pasando', undefined)
    else cambiarEstado(i, 'critico', `HTTP ${estado}${datos?.motivo ? `: ${datos.motivo}` : ''}`)
  } catch (error) {
    i.latencia_ms = undefined
    i.ultimo_chequeo = new Date().toISOString()
    cambiarEstado(i, 'critico', error?.motivo === 'timeout' ? 'no respondió a tiempo' : 'no se pudo conectar')
  }
}

function barrer() {
  const ahora = Date.now()
  for (const [nombre, instancias] of servicios) {
    for (const [id, i] of instancias) {
      const sinLatido = ahora - Date.parse(i.ultimo_latido) > TTL_MS
      const criticaDemasiado = i.critico_desde && ahora - i.critico_desde > BAJA_CRITICO_MS
      if (sinLatido || criticaDemasiado) {
        instancias.delete(id)
        console.log(
          `[registro] ${nombre}/${id}: dada de baja (${sinLatido ? `sin latido hace más de ${TTL_MS / 1000} s` : 'crítica por demasiado tiempo'})`,
        )
      }
    }
  }
}

setInterval(async () => {
  barrer()
  const todas = [...servicios.values()].flatMap((m) => [...m.values()])
  await Promise.all(todas.map(chequear))
}, CHEQUEO_MS).unref?.()

crearServicio({
  nombre: 'registro',
  puerto: CONFIG.registro.puerto,
  registrar: false, // sería raro que el registro se anotara en sí mismo
  // Cada servicio late cada 3 s y cada cliente baja la lista cada 2 s: lo
  // que importa del registro (altas, bajas, cambios de estado) ya se
  // imprime aparte, no cada latido.
  rutasSilenciosas: ['/api/v1/servicios'],
  rutas: {
    'GET /salud': () => ({
      servicio: 'registro',
      servicios: servicios.size,
      instancias: [...servicios.values()].reduce((n, m) => n + m.size, 0),
      ttl_ms: TTL_MS,
      chequeo_ms: CHEQUEO_MS,
    }),

    /**
     * Registrar una instancia, o renovarla: es idempotente y es el
     * latido. Si ya existía conserva su estado de salud — no vuelve a
     * `desconocido` por latir.
     */
    'PUT /api/v1/servicios/:nombre/:id': ({ params, cuerpo }) => {
      const { nombre, id } = params
      if (!/^[a-z][a-z0-9-]{1,40}$/.test(nombre)) throw new ErrorHttp(400, 'nombre de servicio inválido')
      if (!URL_VALIDA.test(String(cuerpo?.url ?? ''))) throw new ErrorHttp(400, 'url debe ser http(s)://host:puerto')

      if (!servicios.has(nombre)) servicios.set(nombre, new Map())
      const instancias = servicios.get(nombre)
      const existente = instancias.get(id)
      const ahora = new Date().toISOString()

      if (existente) {
        existente.url = cuerpo.url.replace(/\/$/, '')
        existente.version = cuerpo.version ?? existente.version
        existente.ultimo_latido = ahora
        return { ...publica(existente), ttl_ms: TTL_MS }
      }

      const nueva = {
        id,
        nombre,
        url: cuerpo.url.replace(/\/$/, ''),
        version: cuerpo.version,
        estado: 'desconocido',
        registrada_en: ahora,
        ultimo_latido: ahora,
      }
      instancias.set(id, nueva)
      console.log(`[registro] ${nombre}/${id}: registrada en ${nueva.url}`)
      // Primer chequeo ya, sin esperar al próximo ciclo: una instancia
      // nueva aparece como sana en milisegundos, no en segundos.
      chequear(nueva)
      return { ...publica(nueva), ttl_ms: TTL_MS }
    },

    /** Baja ordenada (el servicio se está cerrando). */
    'DELETE /api/v1/servicios/:nombre/:id': ({ params }) => {
      const instancias = servicios.get(params.nombre)
      if (!instancias?.delete(params.id)) throw new ErrorHttp(404, 'no hay una instancia registrada con ese id')
      console.log(`[registro] ${params.nombre}/${params.id}: dada de baja`)
      return { ok: true }
    },

    /** Todos los servicios. Con `solo_sanas=true`, sólo las instancias
     *  que pasaron el último health check — es lo que usan los clientes. */
    'GET /api/v1/servicios': ({ query }) => {
      const soloSanas = query.solo_sanas === 'true'
      return {
        generado_en: new Date().toISOString(),
        servicios: Object.fromEntries(
          [...servicios.keys()].sort().map((nombre) => [
            nombre,
            instanciasDe(nombre)
              .filter((i) => !soloSanas || i.estado === 'pasando')
              .map(publica),
          ]),
        ),
      }
    },

    'GET /api/v1/servicios/:nombre': ({ params, query }) => {
      const soloSanas = query.solo_sanas === 'true'
      return {
        nombre: params.nombre,
        conocido: servicios.has(params.nombre),
        instancias: instanciasDe(params.nombre)
          .filter((i) => !soloSanas || i.estado === 'pasando')
          .map(publica),
      }
    },
  },
})
