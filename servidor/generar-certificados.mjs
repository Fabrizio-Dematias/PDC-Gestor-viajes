import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Genera los certificados para `TLS=on` (servidor/comun/tls.js):
 *
 *   npm run tls:certs            # no pisa los que ya existen
 *   npm run tls:certs -- --forzar
 *
 * - `ca.crt` / `ca.key`: una autoridad certificadora propia del sistema.
 * - `<servicio>.crt` / `<servicio>.key`: uno por servicio, firmado por la
 *   CA, con el nombre del servicio como CN. Vale como certificado de
 *   servidor y de cliente (mTLS). Los nombres alternativos cubren
 *   `localhost` y el nombre del servicio dentro de Docker Compose.
 *
 * Quedan en `certs/`, fuera del repositorio (.gitignore): las claves
 * privadas no se versionan. Usa el `openssl` del sistema.
 */
/** Los servicios, más `front`: el servidor de desarrollo de Vite. */
const SERVICIOS = ['agregador', 'vuelos', 'hospedaje', 'traslado', 'usuarios', 'notificaciones', 'registro', 'nodo-agencia', 'front']
const DIAS_CA = 3650
/** El máximo que aceptan los navegadores para un certificado de servidor. */
const DIAS_SERVICIO = 397

const destino = process.env.TLS_DIR ?? fileURLToPath(new URL('../certs/', import.meta.url))
const forzar = process.argv.includes('--forzar')
const en = (archivo) => path.join(destino, archivo)
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] })

if (existsSync(en('ca.crt')) && !forzar) {
  console.log(`Ya hay certificados en ${destino}. Para regenerarlos: npm run tls:certs -- --forzar`)
  process.exit(0)
}
if (forzar) rmSync(destino, { recursive: true, force: true })
mkdirSync(destino, { recursive: true })

// La CA: curva P-256, autofirmada.
openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', en('ca.key'))
openssl(
  'req', '-x509', '-new', '-key', en('ca.key'), '-sha256', '-days', String(DIAS_CA),
  '-subj', '/O=Gestor de viajes/CN=Gestor de viajes CA',
  '-addext', 'basicConstraints=critical,CA:TRUE',
  '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  '-out', en('ca.crt'),
)

for (const nombre of SERVICIOS) {
  const extensiones = en(`${nombre}.ext`)
  writeFileSync(
    extensiones,
    [
      'basicConstraints=CA:FALSE',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth,clientAuth',
      `subjectAltName=DNS:localhost,DNS:${nombre},IP:127.0.0.1,IP:::1`,
    ].join('\n'),
  )
  openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', en(`${nombre}.key`))
  openssl('req', '-new', '-key', en(`${nombre}.key`), '-subj', `/O=Gestor de viajes/CN=${nombre}`, '-out', en(`${nombre}.csr`))
  openssl(
    'x509', '-req', '-in', en(`${nombre}.csr`), '-CA', en('ca.crt'), '-CAkey', en('ca.key'), '-CAcreateserial',
    '-days', String(DIAS_SERVICIO), '-sha256', '-extfile', extensiones, '-out', en(`${nombre}.crt`),
  )
  rmSync(en(`${nombre}.csr`))
  rmSync(extensiones)
}
rmSync(en('ca.srl'), { force: true })

console.log(`Certificados en ${destino}: ca.crt y uno por servicio (${SERVICIOS.join(', ')}).`)
console.log('Para que el navegador confíe en el agregador, agregar ca.crt como raíz de confianza (ver docs/informe-amenazas.md).')
