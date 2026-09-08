import { randomInt, randomUUID } from 'node:crypto'
import { pool } from '../comun/basePg.js'
import { CONFIG, VERTICALES } from '../comun/config.js'
import { hashear, verificar as verificarPassword } from '../comun/contrasenas.js'
import { crearProveedorEmail } from '../comun/email.js'
import { crearServicio, ErrorHttp } from '../comun/http.js'
import { crearEsquema, sembrar } from './datos.js'

const PERMISOS_VALIDOS = ['gestion_verticales', 'gestion_usuarios']
const CODIGO_TTL_MIN = 15
const proveedorEmail = crearProveedorEmail()

await crearEsquema(pool)
const { total } = await sembrar(pool)
console.log(`[usuarios] Postgres listo: ${total} usuarios (agencias ag-demo, ag-sur)`)

const USUARIO_POR_DEFECTO = 'u-001'
/** Agencia con la que se resuelve una request que no manda la cabecera
 *  — ver docs/arquitectura-multi-nodo.md §2: la agencia por defecto es
 *  la que ya tenía todo el sistema antes de sumar marca blanca, así que
 *  todo lo que no manda esta cabecera se comporta exactamente igual que
 *  antes. */
const AGENCIA_POR_DEFECTO = 'ag-demo'

/**
 * Fase 3 reemplaza esto por un token verificado. Hoy los dos
 * identificadores viajan en cabeceras y se confía en ellas: alcanza
 * para que el agregador sepa de quién y de qué agencia son las
 * preferencias, pero **no es autenticación** y no debe presentarse
 * como tal — mismo criterio ya documentado para `x-usuario-id`.
 */
function quienEs(headers) {
  return headers['x-usuario-id'] ?? USUARIO_POR_DEFECTO
}
function queAgencia(headers) {
  return headers['x-agencia-id'] ?? AGENCIA_POR_DEFECTO
}

async function leerPerfil(id) {
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id])
  const usuario = rows[0]
  if (!usuario) throw new ErrorHttp(404, `no existe el usuario ${id}`)

  const { rows: filas } = await pool.query(
    'SELECT vertical, activo FROM preferencias WHERE usuario_id = $1',
    [id],
  )
  const preferencias = Object.fromEntries(VERTICALES.map((v) => [v, true]))
  for (const f of filas) preferencias[f.vertical] = f.activo

  return {
    id: usuario.id,
    nombre: usuario.nombre,
    rol: usuario.rol,
    agencia_id: usuario.agencia_id,
    preferencias,
  }
}

async function leerConfig(agenciaId) {
  const { rows } = await pool.query(
    'SELECT vertical, estado, motivo FROM config_verticales WHERE agencia_id = $1',
    [agenciaId],
  )
  return Object.fromEntries(
    rows.map((f) => [f.vertical, { estado: f.estado, ...(f.motivo ? { motivo: f.motivo } : {}) }]),
  )
}

/** Branding + verticales habilitados de una agencia. Lo consume
 *  `GET /api/tenant/config` del agregador (docs/arquitectura-multi-nodo.md §3). */
async function leerAgencia(agenciaId) {
  const { rows } = await pool.query('SELECT * FROM agencias WHERE id = $1', [agenciaId])
  const agencia = rows[0]
  if (!agencia) throw new ErrorHttp(404, `no existe la agencia ${agenciaId}`)

  const config = await leerConfig(agenciaId)
  const verticales_habilitados = VERTICALES.filter((v) => config[v]?.estado !== 'inactivo')

  return {
    id: agencia.id,
    nombre: agencia.nombre,
    color_primario: agencia.color_primario,
    descripcion: agencia.descripcion,
    verticales_habilitados,
  }
}

// --- Login (contrato §10): registro por email con verificación, o
// usuario/contraseña para administradores. El JWT lo firma el
// agregador — acá sólo se valida contra Postgres y se devuelve el
// registro del usuario. ---

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function generarCodigo() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Lo que puede viajar fuera de este servicio — nunca `password_hash`. */
function usuarioPublico(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    rol: u.rol,
    agencia_id: u.agencia_id,
    email: u.email ?? undefined,
    username: u.username ?? undefined,
    permisos: u.permisos ?? [],
  }
}

async function enviarCodigoDeVerificacion(email) {
  const codigo = generarCodigo()
  await pool.query(
    `INSERT INTO verificaciones_email (email, codigo, expira)
     VALUES ($1, $2, now() + interval '${CODIGO_TTL_MIN} minutes')
     ON CONFLICT (email) DO UPDATE SET codigo = excluded.codigo, expira = excluded.expira`,
    [email, codigo],
  )
  await proveedorEmail.enviarCodigo({ email, codigo })
  // Sólo el proveedor ficticio expone el código acá — uno real no
  // tendría este campo, porque el código ya viajó por su cuenta.
  return proveedorEmail.nombre === 'ficticio' ? { codigo_demo: codigo } : {}
}

crearServicio({
  nombre: 'usuarios',
  puerto: CONFIG.usuarios.puerto,
  rutas: {
    'GET /salud': async () => {
      const [usuarios, agencias] = await Promise.all([
        pool.query('SELECT COUNT(*) AS n FROM usuarios'),
        pool.query('SELECT COUNT(*) AS n FROM agencias'),
      ])
      return {
        servicio: 'usuarios',
        usuarios: Number(usuarios.rows[0].n),
        agencias: Number(agencias.rows[0].n),
      }
    },

    'GET /api/perfil': ({ headers }) => leerPerfil(quienEs(headers)),

    /**
     * Actualización parcial: se manda sólo lo que cambió.
     *
     * Hasta la Etapa 3 esta ruta también aceptaba `rol` en el cuerpo —
     * era la autopromoción a admin de la demo (`Perfil.jsx`), con un
     * `<select>`. Login real (§10 del contrato) la reemplaza: el rol
     * ahora lo fija el login, no el propio usuario.
     */
    'PUT /api/perfil': async ({ headers, cuerpo }) => {
      const id = quienEs(headers)
      await leerPerfil(id) // 404 si no existe

      if (typeof cuerpo?.nombre === 'string' && cuerpo.nombre.trim()) {
        await pool.query('UPDATE usuarios SET nombre = $1 WHERE id = $2', [cuerpo.nombre.trim(), id])
      }
      if (cuerpo?.preferencias) {
        for (const vertical of VERTICALES) {
          if (vertical in cuerpo.preferencias) {
            await pool.query(
              `INSERT INTO preferencias (usuario_id, vertical, activo) VALUES ($1, $2, $3)
               ON CONFLICT (usuario_id, vertical) DO UPDATE SET activo = excluded.activo`,
              [id, vertical, Boolean(cuerpo.preferencias[vertical])],
            )
          }
        }
      }
      return leerPerfil(id)
    },

    'GET /api/agencias/:id': ({ params }) => leerAgencia(params.id),

    /** Alta de cliente por email. La agencia sale de la cabecera: te
     *  registrás en la agencia cuyo front estás usando. */
    'POST /api/auth/registro': async ({ headers, cuerpo }) => {
      const email = String(cuerpo?.email ?? '').trim().toLowerCase()
      const nombre = String(cuerpo?.nombre ?? '').trim()
      const password = String(cuerpo?.password ?? '')
      if (!EMAIL_VALIDO.test(email)) throw new ErrorHttp(400, 'email inválido')
      if (!nombre) throw new ErrorHttp(400, 'falta el nombre')
      if (password.length < 8) throw new ErrorHttp(400, 'la contraseña debe tener al menos 8 caracteres')

      const { rows: existente } = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email])
      if (existente.length > 0) throw new ErrorHttp(409, 'ya existe una cuenta con ese email')

      const id = `u-${randomUUID()}`
      await pool.query(
        `INSERT INTO usuarios (id, nombre, rol, agencia_id, email, password_hash, email_verificado)
         VALUES ($1, $2, 'usuario', $3, $4, $5, false)`,
        [id, nombre, queAgencia(headers), email, hashear(password)],
      )
      for (const vertical of VERTICALES) {
        await pool.query('INSERT INTO preferencias (usuario_id, vertical, activo) VALUES ($1, $2, true)', [
          id,
          vertical,
        ])
      }

      const demo = await enviarCodigoDeVerificacion(email)
      return { ok: true, email, ...demo }
    },

    'POST /api/auth/reenviar-codigo': async ({ cuerpo }) => {
      const email = String(cuerpo?.email ?? '').trim().toLowerCase()
      const { rows } = await pool.query(
        'SELECT email_verificado FROM usuarios WHERE email = $1',
        [email],
      )
      if (rows.length === 0) throw new ErrorHttp(404, 'no existe una cuenta con ese email')
      if (rows[0].email_verificado) throw new ErrorHttp(400, 'ese email ya está verificado')

      const demo = await enviarCodigoDeVerificacion(email)
      return { ok: true, email, ...demo }
    },

    /**
     * Confirma el código y devuelve el usuario ya verificado, para que
     * el agregador pueda loguearlo directo sin pedirle la contraseña
     * de nuevo — mismo criterio que cualquier alta con verificación:
     * una vez confirmado el email, no tiene sentido frenarlo otra vez.
     */
    'POST /api/auth/verificar-email': async ({ cuerpo }) => {
      const email = String(cuerpo?.email ?? '').trim().toLowerCase()
      const codigo = String(cuerpo?.codigo ?? '').trim()

      const { rows } = await pool.query(
        'SELECT codigo, expira FROM verificaciones_email WHERE email = $1',
        [email],
      )
      const pendiente = rows[0]
      if (!pendiente || pendiente.codigo !== codigo || new Date(pendiente.expira) < new Date()) {
        throw new ErrorHttp(400, 'código inválido o vencido')
      }

      await pool.query('UPDATE usuarios SET email_verificado = true WHERE email = $1', [email])
      await pool.query('DELETE FROM verificaciones_email WHERE email = $1', [email])

      const { rows: usuario } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email])
      return usuarioPublico(usuario[0])
    },

    /**
     * La usa el agregador para el login (§10): busca por email o por
     * username, exige email verificado sólo para cuentas de email, y
     * devuelve el usuario si la contraseña coincide. El agregador es
     * quien firma el JWT — acá no se sabe qué es un token.
     */
    'POST /api/auth/verificar-credenciales': async ({ cuerpo }) => {
      const identificador = String(cuerpo?.identificador ?? '').trim().toLowerCase()
      const password = String(cuerpo?.password ?? '')

      const { rows } = await pool.query(
        'SELECT * FROM usuarios WHERE email = $1 OR username = $1',
        [identificador],
      )
      const usuario = rows[0]
      if (!usuario || !verificarPassword(password, usuario.password_hash)) {
        throw new ErrorHttp(401, { error: 'credenciales inválidas', motivo: 'credenciales_invalidas' })
      }
      if (usuario.email === identificador && !usuario.email_verificado) {
        throw new ErrorHttp(403, { error: 'falta verificar el email', motivo: 'email_no_verificado' })
      }
      return usuarioPublico(usuario)
    },

    /** Administradores de la agencia de quien pide — la resuelve el
     *  agregador a partir de la sesión de quien está logueado, nunca
     *  del cuerpo. */
    'GET /api/admin/administradores': async ({ headers }) => {
      const { rows } = await pool.query(
        "SELECT id, nombre, username, permisos FROM usuarios WHERE agencia_id = $1 AND rol = 'admin' ORDER BY username",
        [queAgencia(headers)],
      )
      return rows
    },

    'POST /api/admin/administradores': async ({ headers, cuerpo }) => {
      const username = String(cuerpo?.username ?? '').trim().toLowerCase()
      const password = String(cuerpo?.password ?? '')
      const permisos = Array.isArray(cuerpo?.permisos)
        ? cuerpo.permisos.filter((p) => PERMISOS_VALIDOS.includes(p))
        : []
      if (!username) throw new ErrorHttp(400, 'falta el nombre de usuario')
      if (password.length < 8) throw new ErrorHttp(400, 'la contraseña debe tener al menos 8 caracteres')

      const { rows: existente } = await pool.query('SELECT id FROM usuarios WHERE username = $1', [
        username,
      ])
      if (existente.length > 0) throw new ErrorHttp(409, 'ya existe un administrador con ese usuario')

      const agenciaId = queAgencia(headers)
      const id = `admin-${randomUUID()}`
      await pool.query(
        `INSERT INTO usuarios (id, nombre, rol, agencia_id, username, password_hash, email_verificado, permisos)
         VALUES ($1, $2, 'admin', $3, $4, $5, true, $6)`,
        [id, username, agenciaId, username, hashear(password), permisos],
      )
      await pool.query(
        `INSERT INTO auditoria (agencia_id, cuando, quien, vertical, antes, despues)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [agenciaId, new Date().toISOString(), quienEs(headers), `admin:${username}`, null, 'creado'],
      )

      const { rows } = await pool.query(
        "SELECT id, nombre, username, permisos FROM usuarios WHERE agencia_id = $1 AND rol = 'admin' ORDER BY username",
        [agenciaId],
      )
      return rows
    },

    'PUT /api/admin/administradores/:id/permisos': async ({ params, headers, cuerpo }) => {
      const agenciaId = queAgencia(headers)
      const permisos = Array.isArray(cuerpo?.permisos)
        ? cuerpo.permisos.filter((p) => PERMISOS_VALIDOS.includes(p))
        : []

      const { rows: antes } = await pool.query(
        "SELECT username, permisos FROM usuarios WHERE id = $1 AND agencia_id = $2 AND rol = 'admin'",
        [params.id, agenciaId],
      )
      if (antes.length === 0) throw new ErrorHttp(404, 'no existe ese administrador en tu agencia')

      await pool.query('UPDATE usuarios SET permisos = $1 WHERE id = $2', [permisos, params.id])
      await pool.query(
        `INSERT INTO auditoria (agencia_id, cuando, quien, vertical, antes, despues)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          agenciaId,
          new Date().toISOString(),
          quienEs(headers),
          `permisos:${antes[0].username}`,
          JSON.stringify(antes[0].permisos),
          JSON.stringify(permisos),
        ],
      )

      const { rows } = await pool.query(
        "SELECT id, nombre, username, permisos FROM usuarios WHERE agencia_id = $1 AND rol = 'admin' ORDER BY username",
        [agenciaId],
      )
      return rows
    },

    'GET /api/admin/config': ({ headers }) => leerConfig(queAgencia(headers)),

    'PUT /api/admin/config/:vertical': async ({ params, cuerpo, headers }) => {
      const { vertical } = params
      const agenciaId = queAgencia(headers)
      if (!VERTICALES.includes(vertical)) throw new ErrorHttp(404, `vertical desconocido: ${vertical}`)
      if (cuerpo?.estado !== 'activo' && cuerpo?.estado !== 'inactivo') {
        throw new ErrorHttp(400, "estado debe ser 'activo' o 'inactivo'")
      }

      const { rows: antes } = await pool.query(
        'SELECT estado FROM config_verticales WHERE agencia_id = $1 AND vertical = $2',
        [agenciaId, vertical],
      )
      await pool.query(
        `INSERT INTO config_verticales (agencia_id, vertical, estado, motivo)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (agencia_id, vertical) DO UPDATE
           SET estado = excluded.estado, motivo = excluded.motivo`,
        [agenciaId, vertical, cuerpo.estado, cuerpo.motivo ?? null],
      )
      await pool.query(
        `INSERT INTO auditoria (agencia_id, cuando, quien, vertical, antes, despues)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [agenciaId, new Date().toISOString(), quienEs(headers), vertical, antes[0]?.estado ?? null, cuerpo.estado],
      )

      return leerConfig(agenciaId)
    },

    /** Se calcula con SQL sobre la población real de la base, filtrada
     *  a los usuarios de esta agencia. */
    'GET /api/admin/preferencias-agregadas': async ({ headers }) => {
      const agenciaId = queAgencia(headers)
      const [{ rows: totalRows }, { rows: filas }] = await Promise.all([
        pool.query('SELECT COUNT(*) AS n FROM usuarios WHERE agencia_id = $1', [agenciaId]),
        pool.query(
          `SELECT p.vertical, SUM(CASE WHEN p.activo THEN 1 ELSE 0 END) AS cuantos
           FROM preferencias p JOIN usuarios u ON u.id = p.usuario_id
           WHERE u.agencia_id = $1
           GROUP BY p.vertical`,
          [agenciaId],
        ),
      ])
      return {
        total_usuarios: Number(totalRows[0].n),
        ...Object.fromEntries(filas.map((f) => [f.vertical, Number(f.cuantos)])),
      }
    },

    'GET /api/admin/auditoria': async ({ headers }) => {
      const { rows } = await pool.query(
        'SELECT * FROM auditoria WHERE agencia_id = $1 ORDER BY id DESC LIMIT 50',
        [queAgencia(headers)],
      )
      return rows
    },

    /**
     * Acá sincroniza la BD temporal de un nodo de agencia
     * (servidor/nodo-agencia/): un lote de búsquedas que se hicieron en
     * el borde y se guardan acá para consolidarse con las de todas las
     * agencias. No lo llama el front — lo llama el propio nodo de
     * agencia, vía el agregador (docs/arquitectura-multi-nodo.md §4).
     */
    'POST /api/agencias/:id/registro': async ({ params, cuerpo }) => {
      const entradas = Array.isArray(cuerpo?.entradas) ? cuerpo.entradas : []
      for (const e of entradas) {
        await pool.query(
          `INSERT INTO registro_busquedas (agencia_id, vertical, estado, motivo, criterios, buscado_en)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            params.id,
            e.vertical,
            e.estado,
            e.motivo ?? null,
            e.criterios ? JSON.stringify(e.criterios) : null,
            e.buscado_en ?? new Date().toISOString(),
          ],
        )
      }
      return { insertadas: entradas.length }
    },
  },
})
