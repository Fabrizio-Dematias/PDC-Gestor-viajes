import { execFileSync } from 'node:child_process'
import { CONFIG } from './comun/config.js'

/**
 * Apaga un servicio por su puerto, para la demostración.
 *
 *   node servidor/matar.mjs hospedaje
 *
 * Equivale al `docker stop` de la Fase 5. Para volver a levantarlo:
 *   npm run back:hospedaje
 */
const nombre = process.argv[2]
const servicio = CONFIG[nombre]

if (!servicio?.puerto) {
  console.error(`Uso: node servidor/matar.mjs <vuelos|hospedaje|usuarios|agregador>`)
  process.exit(1)
}

try {
  // `-sTCP:LISTEN` es imprescindible: sin él, lsof también devuelve los
  // procesos que tienen una conexión *abierta hacia* ese puerto — es
  // decir, el agregador — y matarlos se lleva puesto medio sistema.
  const pids = execFileSync(
    'lsof',
    ['-ti', `tcp:${servicio.puerto}`, '-sTCP:LISTEN'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)

  if (pids.length === 0) {
    console.log(`[${nombre}] no había nada escuchando en el puerto ${servicio.puerto}`)
    process.exit(0)
  }
  for (const pid of pids) process.kill(Number(pid), 'SIGTERM')
  console.log(`[${nombre}] apagado (puerto ${servicio.puerto}, pid ${pids.join(', ')})`)
} catch {
  console.log(`[${nombre}] no había nada escuchando en el puerto ${servicio.puerto}`)
}
