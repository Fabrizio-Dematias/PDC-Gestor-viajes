import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

/**
 * Cada microservicio abre su propia base, en su propia carpeta. No hay
 * una base compartida y ningún servicio puede leer la del otro: si
 * quiere un dato ajeno tiene que pedirlo por HTTP. Es la parte de
 * "microservicios con base propia" del Módulo 2, y es lo que hace que
 * apagar un servicio se sienta de verdad.
 */
export function abrirBase(metaUrl, archivo) {
  const carpeta = join(dirname(fileURLToPath(metaUrl)), 'datos')
  mkdirSync(carpeta, { recursive: true })
  const base = new DatabaseSync(join(carpeta, archivo))
  base.exec('PRAGMA journal_mode = WAL')
  base.exec('PRAGMA foreign_keys = ON')
  return base
}
