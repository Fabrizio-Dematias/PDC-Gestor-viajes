import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Levanta los cinco servicios del nodo central + nodo de cómputo en un
 * solo comando (no incluye `nodo-agencia`: ese no es parte de estos dos
 * nodos, se levanta aparte, una instancia por agencia).
 *
 * Es comodidad de desarrollo, no despliegue: siguen siendo procesos
 * independientes con su propio puerto, y matar uno no afecta a los
 * otros. En despliegue esto lo reemplazan `docker-compose.central.yml` y
 * `docker-compose.workers.yml`, con la misma topología repartida en dos
 * nodos físicos.
 */
const SERVICIOS = ['usuarios', 'vuelos', 'hospedaje', 'traslado', 'agregador']

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
