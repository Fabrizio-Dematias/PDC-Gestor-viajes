import pg from 'pg'
import { CONFIG } from './config.js'

/**
 * Pool de Postgres del nodo central. Lo comparten `usuarios` y
 * `agregador` — es la única base que no es propia de un servicio, a
 * propósito: `agencias`, `usuarios`, `preferencias`, `config_verticales`
 * y `auditoria` son datos transversales a todas las agencias, no de un
 * solo vertical. Los verticales (vuelos, hospedaje, traslado) siguen con
 * su SQLite propia (`abrirBase`): ese dato no cambia de lugar.
 */
const { Pool } = pg

export const pool = new Pool(CONFIG.postgres)
