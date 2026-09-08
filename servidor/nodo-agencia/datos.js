/**
 * Esquema de la "BD temporal" del nodo de agencia
 * (docs/arquitectura-multi-nodo.md §2 y §4): una bitácora local de
 * búsquedas, que existe para que la agencia pueda seguir registrando
 * actividad aunque el nodo central esté inalcanzable, y se sincroniza
 * sola cuando vuelve a estar disponible (`index.js`).
 *
 * No guarda catálogo — eso siempre viene en vivo del Gateway — sólo lo
 * que se genera en el borde.
 */
export function crearEsquema(base) {
  base.exec(`
    CREATE TABLE IF NOT EXISTS registro (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vertical      TEXT    NOT NULL,
      estado        TEXT    NOT NULL,
      motivo        TEXT,
      criterios     TEXT,
      buscado_en    TEXT    NOT NULL,
      sincronizado  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pendientes ON registro (sincronizado);
  `)
}
