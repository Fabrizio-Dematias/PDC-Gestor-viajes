import { VERTICALES } from '../comun/config.js'
import { hashear } from '../comun/contrasenas.js'

/**
 * Esquema y siembra del nodo central en Postgres: quién es cada
 * usuario, de qué agencia es, qué verticales quiere ver, qué apagó el
 * administrador de cada agencia y quién lo apagó.
 *
 * Es la única base que no es propia de un servicio (a diferencia de
 * vuelos/hospedaje/traslado, que siguen con su SQLite): `agencias`,
 * `usuarios`, `preferencias`, `config_verticales` y `auditoria` son
 * datos transversales a todas las agencias del nodo central, no de un
 * solo vertical — ver docs/arquitectura-multi-nodo.md §2.
 */

export async function crearEsquema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agencias (
      id             TEXT PRIMARY KEY,
      nombre         TEXT NOT NULL,
      color_primario TEXT NOT NULL,
      descripcion    TEXT
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id         TEXT PRIMARY KEY,
      nombre     TEXT NOT NULL,
      rol        TEXT NOT NULL DEFAULT 'usuario',
      agencia_id TEXT NOT NULL REFERENCES agencias(id)
    );

    CREATE TABLE IF NOT EXISTS preferencias (
      usuario_id TEXT    NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      vertical   TEXT    NOT NULL,
      activo     BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (usuario_id, vertical)
    );

    -- Antes tenía "vertical" como única clave: una sola config para
    -- todo el sistema. Ahora cada agencia administra la suya.
    CREATE TABLE IF NOT EXISTS config_verticales (
      agencia_id TEXT NOT NULL REFERENCES agencias(id),
      vertical   TEXT NOT NULL,
      estado     TEXT NOT NULL DEFAULT 'activo',
      motivo     TEXT,
      PRIMARY KEY (agencia_id, vertical)
    );

    -- Módulo 5: queda registro de qué administrador cambió qué, cuándo
    -- y en qué agencia.
    CREATE TABLE IF NOT EXISTS auditoria (
      id         SERIAL PRIMARY KEY,
      agencia_id TEXT NOT NULL,
      cuando     TEXT NOT NULL,
      quien      TEXT NOT NULL,
      vertical   TEXT NOT NULL,
      antes      TEXT,
      despues    TEXT
    );

    -- La "BD temporal" de cada nodo de agencia sincroniza acá: qué se
    -- buscó, con qué resultado, en qué agencia. No la escribe nadie más
    -- que POST /api/agencias/:id/registro — ver servidor/nodo-agencia/.
    CREATE TABLE IF NOT EXISTS registro_busquedas (
      id          SERIAL PRIMARY KEY,
      agencia_id  TEXT NOT NULL,
      vertical    TEXT NOT NULL,
      estado      TEXT NOT NULL,
      motivo      TEXT,
      criterios   TEXT,
      buscado_en  TEXT NOT NULL,
      recibido_en TEXT NOT NULL DEFAULT now()
    );
  `)

  // Login real (Etapa 3): `usuarios` ya existía de antes de sumar auth
  // (nodo central de la Etapa multi-agencia), así que hace falta
  // migrarla en caliente además de crearla — mismo espíritu que el
  // resto del proyecto, "arranca y se actualiza solo".
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos TEXT[] NOT NULL DEFAULT '{}';

    -- Un código pendiente por email; reenviar pisa el anterior.
    CREATE TABLE IF NOT EXISTS verificaciones_email (
      email  TEXT PRIMARY KEY,
      codigo TEXT NOT NULL,
      expira TIMESTAMPTZ NOT NULL
    );
  `)
}

const AGENCIAS_SEMILLA = [
  {
    id: 'ag-demo',
    nombre: 'Gestor de viajes',
    color_primario: '#1565c0',
    descripcion: 'Buscador de vuelos y hospedaje con tolerancia a fallos parciales.',
  },
  {
    id: 'ag-sur',
    nombre: 'Aventura Sur Viajes',
    color_primario: '#b45309',
    descripcion: 'Marca blanca de ejemplo: mismo sistema, otra agencia, otra configuración.',
  },
]

/** Qué vertical arranca activo por agencia. `ag-sur` desactiva traslado
 *  a propósito: cada agencia administra su propia config, no una global. */
const CONFIG_SEMILLA = {
  'ag-demo': Object.fromEntries(VERTICALES.map((v) => [v, { estado: 'activo' }])),
  'ag-sur': {
    vuelos: { estado: 'activo' },
    hospedaje: { estado: 'activo' },
    traslado: { estado: 'inactivo', motivo: 'la agencia todavía no ofrece traslados' },
  },
}

async function sembrarAgencias(client) {
  for (const a of AGENCIAS_SEMILLA) {
    await client.query(
      `INSERT INTO agencias (id, nombre, color_primario, descripcion) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET nombre = excluded.nombre,
             color_primario = excluded.color_primario,
             descripcion = excluded.descripcion`,
      [a.id, a.nombre, a.color_primario, a.descripcion],
    )
  }
  for (const [agenciaId, porVertical] of Object.entries(CONFIG_SEMILLA)) {
    for (const [vertical, { estado, motivo }] of Object.entries(porVertical)) {
      await client.query(
        `INSERT INTO config_verticales (agencia_id, vertical, estado, motivo)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (agencia_id, vertical) DO NOTHING`,
        [agenciaId, vertical, estado, motivo ?? null],
      )
    }
  }
}

async function sembrarUsuarios(client) {
  const { rows } = await client.query('SELECT COUNT(*) AS total FROM usuarios')
  if (Number(rows[0].total) > 0) return { insertados: 0, total: Number(rows[0].total) }

  const nuevoUsuario = (id, nombre, rol, agenciaId) =>
    client.query('INSERT INTO usuarios (id, nombre, rol, agencia_id) VALUES ($1, $2, $3, $4)', [
      id,
      nombre,
      rol,
      agenciaId,
    ])
  const nuevaPref = (usuarioId, vertical, activo) =>
    client.query('INSERT INTO preferencias (usuario_id, vertical, activo) VALUES ($1, $2, $3)', [
      usuarioId,
      vertical,
      activo,
    ])

  // El usuario con el que se navega en la demo, de la agencia por
  // defecto — mismo id de siempre (u-001), mismo comportamiento actual.
  await nuevoUsuario('u-001', 'Invitado', 'usuario', 'ag-demo')
  for (const v of VERTICALES) await nuevaPref('u-001', v, true)

  // Población sintética de ag-demo, para que el panel de administración
  // muestre preferencias agregadas calculadas de verdad.
  let insertados = 1
  for (let i = 2; i <= 128; i++) {
    const id = `u-${String(i).padStart(3, '0')}`
    await nuevoUsuario(id, `Usuario ${i}`, 'usuario', 'ag-demo')
    await nuevaPref(id, 'vuelos', i % 19 !== 0)
    await nuevaPref(id, 'hospedaje', i % 3 !== 0)
    await nuevaPref(id, 'traslado', i % 5 !== 0)
    insertados++
  }

  // Población propia de ag-sur, más chica: alcanza para que sus
  // preferencias agregadas y su aislamiento del resto se puedan mostrar.
  for (let i = 1; i <= 20; i++) {
    const id = `u-sur-${String(i).padStart(3, '0')}`
    await nuevoUsuario(id, `Viajero Sur ${i}`, 'usuario', 'ag-sur')
    await nuevaPref(id, 'vuelos', true)
    await nuevaPref(id, 'hospedaje', i % 4 !== 0)
    await nuevaPref(id, 'traslado', true)
    insertados++
  }

  return { insertados, total: insertados }
}

/**
 * Cuentas con login, a diferencia de `sembrarUsuarios` (que sólo corre
 * una vez): esta corre en **todos** los arranques, para que sumar login
 * a una base que ya tenía usuarios (como la de este proyecto) también
 * les cree sus credenciales. Es idempotente fila por fila, no por toda
 * la función: no pisa una contraseña que alguien ya haya cambiado.
 */
async function sembrarCuentasAuth(client) {
  // u-001 ya existía sin login; se le agrega acá, sólo si todavía no
  // lo tiene.
  await client.query(
    `UPDATE usuarios SET email = $1, password_hash = $2, email_verificado = true
     WHERE id = 'u-001' AND email IS NULL`,
    ['invitado@demo.com', hashear('demo1234')],
  )

  const ADMINS = [
    { id: 'admin-demo', username: 'admin', agenciaId: 'ag-demo' },
    { id: 'admin-sur', username: 'admin-sur', agenciaId: 'ag-sur' },
  ]
  for (const a of ADMINS) {
    await client.query(
      `INSERT INTO usuarios (id, nombre, rol, agencia_id, username, password_hash, email_verificado, permisos)
       VALUES ($1, 'Administrador', 'admin', $2, $3, $4, true, $5)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.agenciaId, a.username, hashear('admin1234'), ['gestion_verticales', 'gestion_usuarios']],
    )
  }
}

export async function sembrar(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await sembrarAgencias(client)
    const resultado = await sembrarUsuarios(client)
    await sembrarCuentasAuth(client)
    await client.query('COMMIT')
    return resultado
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
