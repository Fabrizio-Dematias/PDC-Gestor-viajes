import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Levanta los cuatro servicios en un solo comando.
 *
 * Es comodidad de desarrollo, no despliegue: siguen siendo cuatro
 * procesos independientes con su propio puerto y su propia base, y matar
 * uno no afecta a los otros. En la Fase 5 esto lo reemplaza
 * `docker compose`, con la misma topología.
 */
const SERVICIOS = ['usuarios', 'vuelos', 'hospedaje', 'agregador']

const hijos = new Map()

for (const nombre of SERVICIOS) {
  const guion = fileURLToPath(new URL(`./${nombre}/index.js`, import.meta.url))
  const hijo = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', guion], {
    stdio: 'inherit',
    env: process.env,
  })
  hijos.set(nombre, hijo)

  hijo.on('exit', (codigo, senal) => {
    hijos.delete(nombre)
    // No se cae el resto: es justamente lo que el sistema tiene que
    // aguantar, y durante la demostración se apaga un servicio a
    // propósito.
    console.log(
      `\n*** [${nombre}] se detuvo (${senal ?? `código ${codigo}`}). ` +
        `Los otros ${hijos.size} siguen andando. ***\n`,
    )
  })
}

console.log(`\nArrancando ${SERVICIOS.length} servicios. Ctrl+C corta todos.\n`)

const cortarTodo = () => {
  for (const hijo of hijos.values()) hijo.kill('SIGTERM')
  setTimeout(() => process.exit(0), 300)
}
process.on('SIGINT', cortarTodo)
process.on('SIGTERM', cortarTodo)
