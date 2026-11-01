import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OPENAPI_INTERNO } from '../comun/openapi-interno.js'
import { aYaml } from '../comun/yaml.js'
import { OPENAPI } from './openapi.js'

/**
 * Escribe `docs/openapi.yaml` (la API pública, desde `openapi.js`) y
 * `docs/openapi-interno.yaml` (los contratos entre servicios, desde
 * `servidor/comun/openapi-interno.js`). Esos dos archivos son la única
 * fuente de verdad: los YAML no se editan a mano.
 *
 *   npm run docs:openapi
 *
 * Si se cambia alguno de los dos, hay que volver a correrlo para que el
 * YAML versionado no quede viejo.
 */
function escribir(documento, archivo, fuente) {
  const destino = fileURLToPath(new URL(`../../docs/${archivo}`, import.meta.url))
  const encabezado = `# Generado desde ${fuente} — no editar a mano.
# Se regenera con: npm run docs:openapi
`
  writeFileSync(destino, encabezado + aYaml(documento))
  console.log(`docs/${archivo} escrito (${Object.keys(documento.paths).length} rutas, ${Object.keys(documento.components.schemas).length} esquemas)`)
}

escribir(OPENAPI, 'openapi.yaml', 'servidor/agregador/openapi.js')
escribir(OPENAPI_INTERNO, 'openapi-interno.yaml', 'servidor/comun/openapi-interno.js')
