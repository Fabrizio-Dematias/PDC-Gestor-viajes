import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { aYaml } from '../comun/yaml.js'
import { OPENAPI } from './openapi.js'

/**
 * Escribe `docs/openapi.yaml` a partir de `openapi.js`, que es la única
 * fuente de verdad del contrato de la API.
 *
 *   npm run docs:openapi
 *
 * Si se cambia `openapi.js`, hay que volver a correrlo para que el YAML
 * versionado no quede viejo.
 */
const destino = fileURLToPath(new URL('../../docs/openapi.yaml', import.meta.url))
const encabezado = `# Generado desde servidor/agregador/openapi.js — no editar a mano.
# Se regenera con: npm run docs:openapi
`
writeFileSync(destino, encabezado + aYaml(OPENAPI))
console.log(`docs/openapi.yaml escrito (${Object.keys(OPENAPI.paths).length} rutas, ${Object.keys(OPENAPI.components.schemas).length} esquemas)`)
