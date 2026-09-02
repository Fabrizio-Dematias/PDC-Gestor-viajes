import { abrirBase } from '../comun/base.js'
import { CONFIG, VERTICALES } from '../comun/config.js'
import { crearServicio, ErrorHttp } from '../comun/http.js'
import { crearEsquema, sembrar } from './datos.js'

const base = abrirBase(import.meta.url, 'usuarios.db')
crearEsquema(base)
const { total } = sembrar(base)
console.log(`[usuarios] base propia lista: ${total} usuarios`)

const USUARIO_POR_DEFECTO = 'u-001'

/**
 * Fase 3 reemplaza esto por un token verificado. Hoy el identificador
 * viaja en una cabecera y se confía en ella: alcanza para que el
 * agregador sepa de quién son las preferencias, pero **no es
 * autenticación** y no debe presentarse como tal.
 */
function quienEs(headers) {
  return headers['x-usuario-id'] ?? USUARIO_POR_DEFECTO
}

function leerPerfil(id) {
  const usuario = base.prepare('SELECT * FROM usuarios WHERE id = ?').get(id)
  if (!usuario) throw new ErrorHttp(404, `no existe el usuario ${id}`)

  const filas = base.prepare('SELECT vertical, activo FROM preferencias WHERE usuario_id = ?').all(id)
  const preferencias = Object.fromEntries(VERTICALES.map((v) => [v, true]))
  for (const f of filas) preferencias[f.vertical] = f.activo === 1

  return { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, preferencias }
}

function leerConfig() {
  const filas = base.prepare('SELECT * FROM config_verticales').all()
  return Object.fromEntries(
    filas.map((f) => [f.vertical, { estado: f.estado, ...(f.motivo ? { motivo: f.motivo } : {}) }]),
  )
}

crearServicio({
  nombre: 'usuarios',
  puerto: CONFIG.usuarios.puerto,
  rutas: {
    'GET /salud': () => ({
      servicio: 'usuarios',
      usuarios: base.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n,
    }),

    'GET /api/perfil': ({ headers }) => leerPerfil(quienEs(headers)),

    /**
     * Actualización parcial: se manda sólo lo que cambió. El contrato
     * original sólo contemplaba preferencias; el front también edita
     * nombre y rol, así que la ruta acepta las tres cosas.
     */
    'PUT /api/perfil': ({ headers, cuerpo }) => {
      const id = quienEs(headers)
      leerPerfil(id) // 404 si no existe

      if (typeof cuerpo?.nombre === 'string' && cuerpo.nombre.trim()) {
        base.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').run(cuerpo.nombre.trim(), id)
      }
      if (cuerpo?.rol === 'usuario' || cuerpo?.rol === 'admin') {
        base.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').run(cuerpo.rol, id)
      }
      if (cuerpo?.preferencias) {
        const guardar = base.prepare(`
          INSERT INTO preferencias (usuario_id, vertical, activo) VALUES (?, ?, ?)
          ON CONFLICT (usuario_id, vertical) DO UPDATE SET activo = excluded.activo
        `)
        for (const vertical of VERTICALES) {
          if (vertical in cuerpo.preferencias) {
            guardar.run(id, vertical, cuerpo.preferencias[vertical] ? 1 : 0)
          }
        }
      }
      return leerPerfil(id)
    },

    'GET /api/admin/config': () => leerConfig(),

    'PUT /api/admin/config/:vertical': ({ params, cuerpo, headers }) => {
      const { vertical } = params
      if (!VERTICALES.includes(vertical)) throw new ErrorHttp(404, `vertical desconocido: ${vertical}`)
      if (cuerpo?.estado !== 'activo' && cuerpo?.estado !== 'inactivo') {
        throw new ErrorHttp(400, "estado debe ser 'activo' o 'inactivo'")
      }

      const antes = base.prepare('SELECT estado FROM config_verticales WHERE vertical = ?').get(vertical)
      base
        .prepare('UPDATE config_verticales SET estado = ?, motivo = ? WHERE vertical = ?')
        .run(cuerpo.estado, cuerpo.motivo ?? null, vertical)
      base
        .prepare('INSERT INTO auditoria (cuando, quien, vertical, antes, despues) VALUES (?, ?, ?, ?, ?)')
        .run(new Date().toISOString(), quienEs(headers), vertical, antes?.estado ?? null, cuerpo.estado)

      return leerConfig()
    },

    /** Se calcula con SQL sobre la población real de la base. */
    'GET /api/admin/preferencias-agregadas': () => {
      const { n } = base.prepare('SELECT COUNT(*) AS n FROM usuarios').get()
      const filas = base
        .prepare('SELECT vertical, SUM(activo) AS cuantos FROM preferencias GROUP BY vertical')
        .all()
      return {
        total_usuarios: n,
        ...Object.fromEntries(filas.map((f) => [f.vertical, Number(f.cuantos)])),
      }
    },

    'GET /api/admin/auditoria': () =>
      base.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 50').all(),
  },
})
