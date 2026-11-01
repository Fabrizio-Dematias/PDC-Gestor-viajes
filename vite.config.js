import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Con `TLS=on` el front también se sirve por HTTPS, con el certificado
 *  que genera `npm run tls:certs` (ver servidor/comun/tls.js). */
function https(mode) {
  if ((process.env.TLS ?? loadEnv(mode, __dirname, '').TLS) !== 'on') return undefined
  const certs = process.env.TLS_DIR ?? path.resolve(__dirname, 'certs')
  return { key: readFileSync(path.join(certs, 'front.key')), cert: readFileSync(path.join(certs, 'front.crt')) }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: { https: https(mode) },
  preview: { https: https(mode) },
}))
