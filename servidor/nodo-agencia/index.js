import { abrirBase } from '../comun/base.js'
import { CONFIG } from '../comun/config.js'
import { crearServicio, ErrorHttp } from '../comun/http.js'
import { pedirJson } from '../comun/pedir.js'
import { crearEsquema } from './datos.js'

/**
 * Nodo de agencia (docs/arquitectura-multi-nodo.md §2, §4): front de
 * marca blanca + esta bitácora local. Se levanta una instancia por
 * agencia, parametrizada por `AGENCIA_ID` — no es un servicio del nodo
 * central ni del de cómputo, así que no entra en `arrancar.mjs`.
 *
 * Lo único que guarda es una bitácora de búsquedas que el front le
 * manda *fire-and-forget*: qué se buscó y con qué resultado. La
 * sincroniza contra el nodo central sola, en segundo plano, y si el
 * central no responde no pierde nada — sólo reintenta en el próximo
 * ciclo. Es la demostración concreta de "front en un servidor separado,
 * resiliente a que el central se caiga".
 */
const agenciaId = CONFIG.agenciaId
const base = abrirBase(import.meta.url, `registro-${agenciaId}.db`)
crearEsquema(base)
console.log(`[nodo-agencia] agencia: ${agenciaId} — sincroniza contra ${CONFIG.urlAgregador}`)

const INTERVALO_SYNC_MS = 5000
const LOTE_MAXIMO = 50

async function sincronizar() {
  const pendientes = base
    .prepare('SELECT * FROM registro WHERE sincronizado = 0 ORDER BY id ASC LIMIT ?')
    .all(LOTE_MAXIMO)
  if (pendientes.length === 0) return

  const entradas = pendientes.map((p) => ({
    vertical: p.vertical,
    estado: p.estado,
    motivo: p.motivo,
    criterios: p.criterios ? JSON.parse(p.criterios) : undefined,
    buscado_en: p.buscado_en,
  }))

  try {
    const { ok } = await pedirJson(`${CONFIG.urlAgregador}/api/agencias/${agenciaId}/registro`, {
      metodo: 'POST',
      cuerpo: { entradas },
      timeoutMs: 3000,
    })
    if (!ok) throw new Error('el central rechazó el lote')

    const marcar = base.prepare('UPDATE registro SET sincronizado = 1 WHERE id = ?')
    base.exec('BEGIN')
    for (const p of pendientes) marcar.run(p.id)
    base.exec('COMMIT')
    console.log(`[nodo-agencia] sincronizadas ${pendientes.length} entradas con el central`)
  } catch (error) {
    // El central no responde: se reintenta en el próximo ciclo. No se
    // pierde nada — es justo el punto de tener esta base acá.
    console.warn(`[nodo-agencia] no se pudo sincronizar (${error?.motivo ?? error?.message}): reintento en ${INTERVALO_SYNC_MS} ms`)
  }
}

setInterval(sincronizar, INTERVALO_SYNC_MS)

crearServicio({
  nombre: 'nodo-agencia',
  puerto: CONFIG.nodoAgencia.puerto,
  rutas: {
    'GET /salud': () => ({
      servicio: 'nodo-agencia',
      agencia_id: agenciaId,
      pendientes: base.prepare('SELECT COUNT(*) AS n FROM registro WHERE sincronizado = 0').get().n,
    }),

    /**
     * La llama el front, sin esperar la respuesta (ver
     * `src/hooks/useBusquedaVertical.js`): guardar acá nunca puede
     * retrasar ni romper el render de resultados, que sigue yendo
     * directo al agregador con su propio timeout, sin pasar por acá.
     */
    'POST /api/registro': ({ cuerpo }) => {
      if (!cuerpo?.vertical || !cuerpo?.estado) {
        throw new ErrorHttp(400, 'faltan vertical o estado')
      }
      base
        .prepare(
          'INSERT INTO registro (vertical, estado, motivo, criterios, buscado_en) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          cuerpo.vertical,
          cuerpo.estado,
          cuerpo.motivo ?? null,
          cuerpo.criterios ? JSON.stringify(cuerpo.criterios) : null,
          cuerpo.buscado_en ?? new Date().toISOString(),
        )
      return { ok: true }
    },
  },
})
