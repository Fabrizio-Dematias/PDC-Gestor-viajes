import { ErrorHttp } from './http.js'

/**
 * Interruptor de fallos del servicio, para la defensa.
 *
 * Matar el proceso ya cubre el caso "servicio caído". Lo que *no* se
 * puede reproducir matándolo es un servicio vivo que acepta la conexión
 * y nunca contesta: ese es el que cuelga a los sistemas sin timeout, y
 * es el que más conviene mostrar. Por eso el interruptor vive dentro del
 * servicio y no afuera.
 *
 * Es código de demostración: cuando el sistema esté en contenedores,
 * estas dos rutas se borran.
 */
export const ESTADOS = ['ok', 'lento', 'caido', 'colgado']

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

export function crearSaludDemo(nombre) {
  let estado = 'ok'
  let listo = true

  return {
    get estado() {
      return estado
    },

    /** ¿El servicio se declara listo (`/salud/ready`)? Es un interruptor
     *  distinto del anterior: el proceso sigue *vivo* y respondiendo, pero
     *  avisa que no está en condiciones de recibir tráfico — como un
     *  servicio que todavía carga datos o cuya base no contesta. */
    get listo() {
      return listo
    },

    rutas: {
      'GET /demo/salud': () => ({ servicio: nombre, estado }),
      'PUT /demo/salud': ({ cuerpo }) => {
        if (!ESTADOS.includes(cuerpo?.estado)) {
          throw new ErrorHttp(400, `estado inválido; usar uno de ${ESTADOS.join(', ')}`)
        }
        estado = cuerpo.estado
        console.log(`[${nombre}] salud simulada → ${estado}`)
        return { servicio: nombre, estado }
      },
      // Liveness vs. readiness (Módulo 4): con `listo: false` el servicio
      // sigue vivo (`/salud/live` → 200) pero `/salud/ready` da 503, el
      // registro lo marca `critico` y el agregador deja de mandarle
      // tráfico — sin reiniciar nada, que es justo lo que corresponde a
      // un servicio vivo-pero-no-listo.
      'GET /demo/listo': () => ({ servicio: nombre, listo }),
      'PUT /demo/listo': ({ cuerpo }) => {
        listo = Boolean(cuerpo?.listo)
        console.log(`[${nombre}] readiness simulada → ${listo ? 'listo' : 'no listo'}`)
        return { servicio: nombre, listo }
      },
    },

    /** Se llama al principio de cada búsqueda. */
    async aplicar(req) {
      if (estado === 'ok') return
      if (estado === 'lento') return espera(1800)
      if (estado === 'caido') {
        throw new ErrorHttp(503, {
          vertical: nombre,
          estado: 'unavailable',
          motivo: 'error',
          generado_en: new Date().toISOString(),
        })
      }
      // colgado: no se responde nunca. Se espera a que el cliente corte
      // —lo hará su AbortController— para no dejar el socket colgando.
      await new Promise((resolve) => req.once('close', resolve))
      throw new ErrorHttp(503, { vertical: nombre, estado: 'unavailable', motivo: 'error' })
    },
  }
}
