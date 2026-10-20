import { createHash } from 'node:crypto'
import { ErrorHttp } from '../comun/http.js'

/**
 * Reservas de vuelos — y con ellas el caso de concurrencia del proyecto
 * (Módulo 3).
 *
 * ## El problema
 *
 * Dos clientes reservan a la vez el último asiento del mismo vuelo. Si
 * cada pedido hace lo "obvio" —leer cuántos asientos quedan, ver que
 * alcanza, esperar la confirmación y escribir el nuevo valor— los dos
 * leen "queda 1" antes de que ninguno escriba, los dos creen que ganaron
 * y el vuelo queda sobrevendido. Es una *actualización perdida*: cada
 * escritura se calculó con un dato que ya estaba viejo.
 *
 * ## Dos mecanismos
 *
 * 1. **Descuento atómico del cupo.** Comprobar y escribir son una sola
 *    sentencia:
 *
 *        UPDATE cupos SET ocupados = ocupados + :n
 *         WHERE vuelo_id = :id AND ocupados + :n <= capacidad
 *
 *    Si no actualiza ninguna fila, no había lugar y se responde 409. Va
 *    dentro de `BEGIN IMMEDIATE`, que toma el bloqueo de escritura de la
 *    base: protege también si hubiera más de un proceso de vuelos sobre
 *    el mismo archivo (Módulo 4: se pueden levantar dos instancias). La
 *    espera de la confirmación del proveedor queda fuera de la sección
 *    crítica — nunca se mantiene un bloqueo mientras se espera la red.
 *    Defensa en profundidad: la tabla tiene `CHECK (ocupados <=
 *    capacidad)`, así que la base rechaza una sobreventa aunque falle la
 *    lógica de la aplicación.
 *
 * 2. **Idempotencia por clave.** El `reserva_id` —la cabecera
 *    `Idempotency-Key` que manda el cliente— es la clave primaria de la
 *    reserva. Repetir un pedido (porque la respuesta se perdió y el
 *    cliente reintenta) devuelve la misma reserva sin descontar otro
 *    asiento. Es lo que hace seguro reintentar tras un timeout: no se
 *    sabe si la primera vez llegó o no, y no importa.
 *
 * ## Modo "ingenuo"
 *
 * Existe a propósito, sólo para la demostración
 * (`PUT /demo/concurrencia`): es la versión sin control, con la ventana
 * entre leer y escribir abierta (la "confirmación del proveedor",
 * simulada con una espera de 15 ms). Activarlo y disparar varios pedidos
 * a la vez muestra primero el defecto y después, con el modo atómico, la
 * solución.
 *
 * ## Modo "actor": la misma carrera, resuelta de otra forma
 *
 * El modelo de actores (Módulo 4) la resuelve sin ninguna sentencia
 * atómica: cada vuelo es un actor con un **buzón**, y los pedidos se
 * atienden de a uno, en orden. Dentro del buzón se puede usar la lógica
 * ingenua —leer, esperar, escribir— porque nadie más está tocando ese
 * vuelo en ese momento: no hay carrera que ganar.
 *
 * Es una alternativa real, con una diferencia que importa: el buzón vive
 * *en memoria de un proceso*. Con una sola instancia de vuelos da el
 * mismo resultado que el UPDATE atómico; con dos instancias cada una
 * tendría sus propios buzones y la carrera volvería (habría que rutear
 * todos los pedidos de un vuelo a la misma instancia). El UPDATE
 * condicional, en cambio, lo ordena la base, así que sigue valiendo
 * con las instancias que se quiera. Por eso el modo por defecto es el
 * atómico y éste queda como comparación.
 */

const CONFIRMACION_PROVEEDOR_MS = 15
const espera = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

/**
 * Buzones del modo "actor": una cola de tareas por vuelo. `encolar` corre
 * la tarea cuando termina la anterior del mismo vuelo (haya salido bien o
 * mal); `enBuzones` toma los de varios vuelos en orden alfabético, así
 * dos reservas que comparten tramos no se esperan una a la otra en
 * círculo (el orden fijo evita el interbloqueo).
 */
const buzones = new Map()
function encolar(clave, tarea) {
  const previa = buzones.get(clave) ?? Promise.resolve()
  const actual = previa.then(tarea, tarea)
  const cola = actual.catch(() => {})
  buzones.set(clave, cola)
  cola.then(() => {
    if (buzones.get(clave) === cola) buzones.delete(clave)
  })
  return actual
}
function enBuzones(claves, tarea) {
  const orden = [...claves].sort()
  const correr = (i) => (i === orden.length ? tarea() : encolar(orden[i], () => correr(i + 1)))
  return correr(0)
}

/** `IBEZEMAD-1-2026-11-20` → ruta de itinerario `IBEZEMAD-1` y fecha. */
const ID_DE_TRAMO = /^([A-Z0-9]{2}[A-Z]{3}[A-Z]{3}-\d)-(\d{4}-\d{2}-\d{2})$/

/** Asientos de un vuelo que no tiene cupo cargado todavía: entre 120 y
 *  300, siempre los mismos para el mismo vuelo. */
function capacidadPorDefecto(vueloId) {
  const h = createHash('sha256').update(vueloId).digest()
  return 120 + (h.readUInt16BE(0) % 181)
}

/** Código corto que ve el cliente: derivado de la clave, así una
 *  repetición devuelve el mismo. */
const codigoDe = (reservaId) => createHash('sha256').update(reservaId).digest('hex').slice(0, 6).toUpperCase()

export function crearReservas(base) {
  // Otro proceso de vuelos puede estar escribiendo: se espera el
  // bloqueo en vez de fallar al primer intento.
  base.exec('PRAGMA busy_timeout = 5000')
  base.exec(`
    CREATE TABLE IF NOT EXISTS cupos (
      vuelo_id  TEXT    PRIMARY KEY,
      capacidad INTEGER NOT NULL CHECK (capacidad >= 0),
      ocupados  INTEGER NOT NULL DEFAULT 0 CHECK (ocupados >= 0),
      CHECK (ocupados <= capacidad)
    );

    -- El id de la reserva es la clave primaria: ahí vive la idempotencia.
    CREATE TABLE IF NOT EXISTS reservas (
      reserva_id TEXT PRIMARY KEY,
      codigo     TEXT NOT NULL,
      vuelos     TEXT NOT NULL,           -- los vuelos tal como se pidieron (JSON)
      pasajeros  INTEGER NOT NULL,
      estado     TEXT NOT NULL DEFAULT 'confirmada',
      email      TEXT,
      nombres    TEXT,                    -- JSON; sólo nombres, nunca documentos
      usuario_id TEXT,
      creada_en  TEXT NOT NULL
    );

    -- Qué asientos descontó cada reserva en cada tramo.
    CREATE TABLE IF NOT EXISTS reserva_tramos (
      reserva_id TEXT    NOT NULL REFERENCES reservas(reserva_id),
      vuelo_id   TEXT    NOT NULL,
      pasajeros  INTEGER NOT NULL,
      PRIMARY KEY (reserva_id, vuelo_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tramo_vuelo ON reserva_tramos (vuelo_id);
  `)

  const existeItinerario = base.prepare('SELECT 1 FROM itinerarios WHERE id = ?')
  const leerCupo = base.prepare('SELECT * FROM cupos WHERE vuelo_id = ?')
  const crearCupo = base.prepare('INSERT OR IGNORE INTO cupos (vuelo_id, capacidad, ocupados) VALUES (?, ?, 0)')
  const descontar = base.prepare(
    'UPDATE cupos SET ocupados = ocupados + ? WHERE vuelo_id = ? AND ocupados + ? <= capacidad',
  )
  const leerReserva = base.prepare('SELECT * FROM reservas WHERE reserva_id = ?')
  const insertarReserva = base.prepare(`
    INSERT INTO reservas (reserva_id, codigo, vuelos, pasajeros, estado, email, nombres, usuario_id, creada_en)
    VALUES (?, ?, ?, ?, 'confirmada', ?, ?, ?, ?)
  `)
  const insertarTramo = base.prepare('INSERT INTO reserva_tramos (reserva_id, vuelo_id, pasajeros) VALUES (?, ?, ?)')
  const tramosDe = base.prepare('SELECT vuelo_id, pasajeros FROM reserva_tramos WHERE reserva_id = ? ORDER BY vuelo_id')
  const vendidosEn = base.prepare('SELECT COALESCE(SUM(pasajeros), 0) AS n, COUNT(*) AS reservas FROM reserva_tramos WHERE vuelo_id = ?')

  let modo = 'atomico'

  /** Un vuelo existe si tiene cupo cargado (los de la demostración) o si
   *  su id corresponde a un itinerario real de la base. Las ofertas de
   *  un proveedor externo (Duffel, Amadeus) no tienen cupo local: esas
   *  no se pueden reservar acá. */
  function existe(vueloId) {
    if (leerCupo.get(vueloId)) return true
    const m = ID_DE_TRAMO.exec(vueloId)
    return Boolean(m && existeItinerario.get(m[1]))
  }

  /** Los ids de tramo de una lista de vuelos: un itinerario con escalas
   *  viene como `tramo~tramo`, y cada tramo tiene su propio cupo. */
  function tramosDeVuelos(vuelos) {
    return [...new Set(vuelos.flatMap((v) => v.split('~')))]
  }

  function serializar(fila, repetida) {
    return {
      reserva_id: fila.reserva_id,
      codigo: fila.codigo,
      estado: fila.estado,
      vuelos: JSON.parse(fila.vuelos),
      tramos: tramosDe.all(fila.reserva_id).map((t) => t.vuelo_id),
      pasajeros: fila.pasajeros,
      email: fila.email ?? undefined,
      creada_en: fila.creada_en,
      repetida,
    }
  }

  /** Mismo id, otro contenido: el cliente reusó la clave para otra
   *  cosa. Devolver la reserva vieja sería contestarle algo que no
   *  pidió. */
  function mismoPedido(fila, { vuelos, pasajeros }) {
    return (
      fila.pasajeros === pasajeros &&
      JSON.stringify([...JSON.parse(fila.vuelos)].sort()) === JSON.stringify([...vuelos].sort())
    )
  }

  function repeticion(fila, pedido) {
    if (!mismoPedido(fila, pedido)) {
      throw new ErrorHttp(422, {
        error: 'esa Idempotency-Key ya se usó para otro pedido',
        motivo: 'clave_reutilizada',
      })
    }
    return { creada: false, reserva: serializar(fila, true) }
  }

  /** La versión correcta: comprobar y descontar en una sola sentencia,
   *  todo dentro de la misma transacción, sin ningún `await` en el medio. */
  function reservarAtomico(pedido, tramos) {
    base.exec('BEGIN IMMEDIATE')
    try {
      const previa = leerReserva.get(pedido.reservaId)
      if (previa) {
        base.exec('COMMIT')
        return repeticion(previa, pedido)
      }

      for (const vueloId of tramos) {
        crearCupo.run(vueloId, capacidadPorDefecto(vueloId))
        if (descontar.run(pedido.pasajeros, vueloId, pedido.pasajeros).changes === 0) {
          base.exec('ROLLBACK') // devuelve también lo descontado en tramos anteriores
          const cupo = leerCupo.get(vueloId)
          return { sinCupo: { vuelo_id: vueloId, libres: cupo.capacidad - cupo.ocupados } }
        }
      }
      const fila = guardar(pedido, tramos)
      base.exec('COMMIT')
      return { creada: true, reserva: serializar(fila, false) }
    } catch (error) {
      try {
        base.exec('ROLLBACK')
      } catch {
        // la transacción ya estaba cerrada
      }
      throw error
    }
  }

  /**
   * La versión con el defecto: lee los asientos libres, **espera** la
   * confirmación del proveedor y escribe un valor calculado con lo que
   * había leído. Entre la lectura y la escritura hay un `await`: otros
   * pedidos entran en esa ventana, ven el mismo "queda 1" y pisan el
   * resultado de los demás. Sólo existe para mostrarlo.
   */
  async function reservarIngenuo(pedido, tramos) {
    const previa = leerReserva.get(pedido.reservaId)
    if (previa) return repeticion(previa, pedido)

    const leidos = new Map()
    for (const vueloId of tramos) {
      crearCupo.run(vueloId, capacidadPorDefecto(vueloId))
      const cupo = leerCupo.get(vueloId)
      if (cupo.capacidad - cupo.ocupados < pedido.pasajeros) {
        return { sinCupo: { vuelo_id: vueloId, libres: cupo.capacidad - cupo.ocupados } }
      }
      leidos.set(vueloId, cupo.ocupados)
    }

    await espera(CONFIRMACION_PROVEEDOR_MS) // ← acá se pisan

    base.exec('BEGIN')
    try {
      for (const [vueloId, ocupados] of leidos) {
        base.prepare('UPDATE cupos SET ocupados = ? WHERE vuelo_id = ?').run(ocupados + pedido.pasajeros, vueloId)
      }
      const fila = guardar(pedido, tramos)
      base.exec('COMMIT')
      return { creada: true, reserva: serializar(fila, false) }
    } catch (error) {
      try {
        base.exec('ROLLBACK')
      } catch {
        // idem
      }
      if (String(error?.message).includes('UNIQUE')) {
        return repeticion(leerReserva.get(pedido.reservaId), pedido)
      }
      throw error
    }
  }

  function guardar(pedido, tramos) {
    insertarReserva.run(
      pedido.reservaId,
      codigoDe(pedido.reservaId),
      JSON.stringify(pedido.vuelos),
      pedido.pasajeros,
      pedido.email ?? null,
      pedido.nombres ? JSON.stringify(pedido.nombres) : null,
      pedido.usuarioId ?? null,
      new Date().toISOString(),
    )
    for (const vueloId of tramos) insertarTramo.run(pedido.reservaId, vueloId, pedido.pasajeros)
    return leerReserva.get(pedido.reservaId)
  }

  return {
    get modo() {
      return modo
    },

    fijarModo(nuevo) {
      if (!['atomico', 'ingenuo', 'actor'].includes(nuevo)) {
        throw new ErrorHttp(400, "modo inválido; usar 'atomico', 'ingenuo' o 'actor'")
      }
      modo = nuevo
      console.log(`[vuelos] concurrencia → ${modo}`)
      return modo
    },

    /**
     * @returns `{ creada, reserva }` o `{ sinCupo: { vuelo_id, libres } }`.
     *   Lanza `ErrorHttp` 404 si algún vuelo no existe.
     */
    async reservar(pedido) {
      const tramos = tramosDeVuelos(pedido.vuelos)

      // Un vuelo que ya salió no se reserva. Se tolera hasta "ayer" en UTC
      // porque la fecha del id es la del reloj del aeropuerto de salida,
      // que puede ir un día por detrás o por delante de UTC.
      const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
      const pasado = tramos.find((t) => (ID_DE_TRAMO.exec(t)?.[2] ?? '9999') < ayer)
      if (pasado) {
        throw new ErrorHttp(422, {
          error: `el vuelo ${pasado} ya salió`,
          motivo: 'vuelo_pasado',
          vuelo_id: pasado,
        })
      }

      const desconocido = tramos.find((t) => !existe(t))
      if (desconocido) {
        throw new ErrorHttp(404, {
          error: `el vuelo ${desconocido} no existe o no se puede reservar acá`,
          motivo: 'vuelo_desconocido',
          vuelo_id: desconocido,
        })
      }
      if (modo === 'actor') return enBuzones(tramos, () => reservarIngenuo(pedido, tramos))
      return modo === 'ingenuo' ? reservarIngenuo(pedido, tramos) : reservarAtomico(pedido, tramos)
    },

    leer(reservaId) {
      const fila = leerReserva.get(reservaId)
      return fila ? serializar(fila, false) : null
    },

    /** Capacidad, ocupación declarada y lo realmente vendido: si no
     *  coinciden, hubo una sobreventa. */
    cupo(vueloId) {
      const cupo = leerCupo.get(vueloId)
      if (!cupo) return null
      const { n, reservas } = vendidosEn.get(vueloId)
      return {
        vuelo_id: vueloId,
        capacidad: cupo.capacidad,
        ocupados: cupo.ocupados,
        libres: cupo.capacidad - cupo.ocupados,
        reservas,
        vendidos: n,
        sobreventa: Math.max(n - cupo.capacidad, 0),
      }
    },

    /** Sólo para la demostración: da de alta (o reinicia) un vuelo con
     *  una capacidad exacta, para poder probar "el último asiento". */
    fijarCupo(vueloId, capacidad) {
      if (!Number.isInteger(capacidad) || capacidad < 0) {
        throw new ErrorHttp(400, 'capacidad debe ser un entero no negativo')
      }
      base.prepare('DELETE FROM reserva_tramos WHERE vuelo_id = ?').run(vueloId)
      base
        .prepare(
          'INSERT INTO cupos (vuelo_id, capacidad, ocupados) VALUES (?, ?, 0) ON CONFLICT (vuelo_id) DO UPDATE SET capacidad = excluded.capacidad, ocupados = 0',
        )
        .run(vueloId, capacidad)
      return this.cupo(vueloId)
    },
  }
}
