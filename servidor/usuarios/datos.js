import { VERTICALES } from '../comun/config.js'

/**
 * Base propia del servicio de usuarios: quién es cada uno, qué
 * verticales quiere ver, qué apagó el administrador y quién lo apagó.
 */

export function crearEsquema(base) {
  base.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id     TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      rol    TEXT NOT NULL DEFAULT 'usuario'
    );

    CREATE TABLE IF NOT EXISTS preferencias (
      usuario_id TEXT    NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      vertical   TEXT    NOT NULL,
      activo     INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (usuario_id, vertical)
    );

    CREATE TABLE IF NOT EXISTS config_verticales (
      vertical TEXT PRIMARY KEY,
      estado   TEXT NOT NULL DEFAULT 'activo',
      motivo   TEXT
    );

    -- Módulo 5: queda registro de qué administrador cambió qué y cuándo.
    CREATE TABLE IF NOT EXISTS auditoria (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      cuando   TEXT NOT NULL,
      quien    TEXT NOT NULL,
      vertical TEXT NOT NULL,
      antes    TEXT,
      despues  TEXT
    );
  `)
}

export function sembrar(base) {
  for (const vertical of VERTICALES) {
    base
      .prepare('INSERT OR IGNORE INTO config_verticales (vertical, estado) VALUES (?, ?)')
      .run(vertical, 'activo')
  }

  const { total } = base.prepare('SELECT COUNT(*) AS total FROM usuarios').get()
  if (total > 0) return { insertados: 0, total }

  const nuevoUsuario = base.prepare('INSERT INTO usuarios (id, nombre, rol) VALUES (?, ?, ?)')
  const nuevaPref = base.prepare(
    'INSERT INTO preferencias (usuario_id, vertical, activo) VALUES (?, ?, ?)',
  )

  base.exec('BEGIN')
  // El usuario con el que se navega en la demo.
  nuevoUsuario.run('u-001', 'Invitado', 'usuario')
  for (const v of VERTICALES) nuevaPref.run('u-001', v, 1)

  // Una población sintética, para que el panel de administración muestre
  // preferencias agregadas calculadas de verdad y no un número inventado.
  for (let i = 2; i <= 128; i++) {
    const id = `u-${String(i).padStart(3, '0')}`
    nuevoUsuario.run(id, `Usuario ${i}`, 'usuario')
    // Casi todos quieren vuelos; hospedaje interesa a unos dos tercios.
    nuevaPref.run(id, 'vuelos', i % 19 === 0 ? 0 : 1)
    nuevaPref.run(id, 'hospedaje', i % 3 === 0 ? 0 : 1)
  }
  base.exec('COMMIT')

  return { insertados: 128, total: 128 }
}
