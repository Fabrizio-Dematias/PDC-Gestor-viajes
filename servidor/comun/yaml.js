/**
 * Serializador mínimo de datos JSON a YAML — lo justo para escribir
 * `docs/openapi.yaml` desde el objeto de `servidor/agregador/openapi.js`
 * sin sumar una dependencia para un solo archivo.
 *
 * Sólo entiende lo que hay en un documento OpenAPI: objetos, listas,
 * textos, números, booleanos y `null`. Los textos que podrían
 * interpretarse como otra cosa (`"200"`, `yes`, `#`, `a: b`, un número)
 * van entre comillas, que en YAML se escriben igual que en JSON.
 */
const RESERVADAS = /^(true|false|null|yes|no|on|off|y|n|~)$/i
const SIMPLE = /^[A-Za-z_][A-Za-z0-9_ ./()+-]*$/

function clave(texto) {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(texto) && !RESERVADAS.test(texto) ? texto : JSON.stringify(texto)
}

function escalar(valor) {
  if (valor === null) return 'null'
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
  const texto = String(valor)
  const plano = SIMPLE.test(texto) && !RESERVADAS.test(texto) && !texto.endsWith(':') && !texto.includes(': ') && !texto.includes(' #')
  return plano && !/^\s|\s$/.test(texto) ? texto : JSON.stringify(texto)
}

const esVacio = (v) => (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && v !== null && Object.keys(v).length === 0)
const esCompuesto = (v) => typeof v === 'object' && v !== null

function lineas(valor, sangria) {
  const pad = ' '.repeat(sangria)
  const salida = []

  if (Array.isArray(valor)) {
    for (const item of valor) {
      if (esCompuesto(item) && !esVacio(item)) {
        const interno = lineas(item, sangria + 2)
        // El guion ocupa el lugar de los dos primeros espacios de la primera línea.
        salida.push(`${pad}- ${interno[0].slice(sangria + 2)}`, ...interno.slice(1))
      } else {
        salida.push(`${pad}- ${esVacio(item) ? (Array.isArray(item) ? '[]' : '{}') : escalar(item)}`)
      }
    }
    return salida
  }

  for (const [k, v] of Object.entries(valor)) {
    if (esCompuesto(v) && !esVacio(v)) {
      salida.push(`${pad}${clave(k)}:`, ...lineas(v, sangria + 2))
    } else if (typeof v === 'string' && v.includes('\n')) {
      // Texto de varias líneas: bloque literal, mucho más legible que
      // una sola línea con "\n".
      salida.push(`${pad}${clave(k)}: |-`, ...v.split('\n').map((l) => (l ? `${pad}  ${l}` : '')))
    } else {
      salida.push(`${pad}${clave(k)}: ${esVacio(v) ? (Array.isArray(v) ? '[]' : '{}') : escalar(v)}`)
    }
  }
  return salida
}

export function aYaml(valor) {
  return `${lineas(valor, 0).join('\n')}\n`
}
