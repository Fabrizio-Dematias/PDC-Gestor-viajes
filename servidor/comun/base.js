import { mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

/**
 * Cada microservicio abre su propia base, en su propia carpeta. No hay
 * una base compartida y ningún servicio puede leer la del otro: si
 * quiere un dato ajeno tiene que pedirlo por HTTP. Es la parte de
 * "microservicios con base propia" del Módulo 2, y es lo que hace que
 * apagar un servicio se sienta de verdad.
 *
 * Por defecto la base queda en `servidor/<servicio>/datos/`. Con
 * `DATOS_DIR` queda en `$DATOS_DIR/<servicio>/` en cambio: así una
 * corrida de pruebas (que reserva asientos, manda avisos…) trabaja sobre
 * copias descartables y no ensucia las bases con las que se hace la
 * demostración.
 */
export function abrirBase(metaUrl, archivo) {
  const carpetaDelServicio = dirname(fileURLToPath(metaUrl))
  const carpeta = process.env.DATOS_DIR
    ? join(process.env.DATOS_DIR, basename(carpetaDelServicio))
    : join(carpetaDelServicio, 'datos')
  mkdirSync(carpeta, { recursive: true })
  const base = new DatabaseSync(join(carpeta, archivo))
  base.exec('PRAGMA journal_mode = WAL')
  base.exec('PRAGMA foreign_keys = ON')
  // Si otro proceso tiene el bloqueo de escritura (dos instancias del mismo
  // servicio sobre el mismo archivo), se espera en vez de fallar enseguida.
  base.exec('PRAGMA busy_timeout = 5000')
  return base
}
