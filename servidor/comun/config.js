/**
 * Configuración de todos los servicios en un solo lugar.
 *
 * Los puertos y URLs salen del entorno para que el día que esto viva en
 * contenedores (Fase 5) alcance con cambiar variables: ningún servicio
 * tiene hardcodeada la dirección de otro.
 */
const n = (valor, porDefecto) => Number(valor ?? porDefecto)

export const CONFIG = {
  agregador: {
    puerto: n(process.env.PUERTO_AGREGADOR, 4000),
  },
  vuelos: {
    puerto: n(process.env.PUERTO_VUELOS, 4001),
    url: process.env.URL_VUELOS ?? 'http://localhost:4001',
  },
  hospedaje: {
    puerto: n(process.env.PUERTO_HOSPEDAJE, 4002),
    url: process.env.URL_HOSPEDAJE ?? 'http://localhost:4002',
  },
  usuarios: {
    puerto: n(process.env.PUERTO_USUARIOS, 4003),
    url: process.env.URL_USUARIOS ?? 'http://localhost:4003',
  },
  traslado: {
    puerto: n(process.env.PUERTO_TRASLADO, 4004),
    url: process.env.URL_TRASLADO ?? 'http://localhost:4004',
  },
  nodoAgencia: {
    puerto: n(process.env.PUERTO_NODO_AGENCIA, 4100),
  },

  /**
   * Nodo central: fuente de verdad compartida entre agencias. Por
   * defecto apunta al Postgres de `docker-compose.central.yml`; para
   * usar un Postgres alojado (Supabase u otro) alcanza con cambiar
   * estas variables — `pg` no sabe ni le importa quién aloja la base.
   */
  postgres: {
    host: process.env.PGHOST ?? 'localhost',
    port: n(process.env.PGPORT, 5432),
    database: process.env.PGDATABASE ?? 'gestor_viajes',
    user: process.env.PGUSER ?? 'gestor',
    password: process.env.PGPASSWORD ?? 'gestor',
    // Supabase (y casi todo Postgres alojado) exige TLS; el contenedor
    // local no lo pide, así que queda apagado por defecto.
    // `rejectUnauthorized: false` porque el certificado de Supabase no
    // valida contra las CAs que trae Node — la propia guía de conexión
    // de Supabase pide lo mismo.
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  },

  /** Nodo central: caché de última respuesta buena + circuit breaker. */
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  /** Agencia con la que arranca una instancia de nodo-agencia. */
  agenciaId: process.env.AGENCIA_ID ?? 'ag-demo',
  urlAgregador: process.env.URL_AGREGADOR ?? 'http://localhost:4000',

  /** Sesión (servidor/comun/jwt.js). Sólo el agregador la usa. El
   *  secreto por defecto alcanza para desarrollo, no para producción —
   *  se avisa una vez al arrancar si no se fijó uno propio. */
  jwt: {
    secreto: process.env.JWT_SECRET ?? 'clave-de-desarrollo-cambiar-en-produccion',
    ttlSeg: n(process.env.JWT_TTL_SEG, 60 * 60 * 24 * 7), // 7 días
  },

  /** Presupuesto de tiempo por tramo. Ver docs/contrato-agregador.md §3. */
  timeouts: {
    /** Agregador → vertical. */
    vertical: n(process.env.TIMEOUT_VERTICAL_MS, 2500),
    /** Vertical → Amadeus. Se corta antes que el de arriba a propósito. */
    amadeus: n(process.env.TIMEOUT_AMADEUS_MS, 1800),
    /** Agregador → usuarios (perfil/config/login/registro). Corto por
     *  defecto porque asume Postgres local (Docker); con Postgres
     *  alojado (Supabase u otro) el round-trip de red por sí solo puede
     *  superar 1200 ms, así que hay que subirlo por env en ese caso. */
    contexto: n(process.env.TIMEOUT_CONTEXTO_MS, 1200),
  },

  /**
   * Qué implementación de ProveedorDeX usa cada vertical.
   * `ficticio` lee de la base propia; `amadeus` pega contra la API real.
   */
  proveedor: process.env.PROVEEDOR ?? 'ficticio',

  amadeus: {
    clave: process.env.AMADEUS_CLIENT_ID,
    secreto: process.env.AMADEUS_CLIENT_SECRET,
    base: process.env.AMADEUS_BASE ?? 'https://test.api.amadeus.com',
    moneda: process.env.AMADEUS_MONEDA ?? 'ARS',
  },

  /** Circuit breaker: fallos seguidos que abren el circuito y cuánto
   *  dura abierto. Caché: cuánto vive la última respuesta buena. */
  breaker: {
    fallosParaAbrir: n(process.env.BREAKER_FALLOS, 3),
    abiertoMs: n(process.env.BREAKER_ABIERTO_MS, 30_000),
    ventanaFalloMs: n(process.env.BREAKER_VENTANA_MS, 60_000),
  },
  cache: {
    ttlMs: n(process.env.CACHE_TTL_MS, 600_000),
  },
}

export const VERTICALES = ['vuelos', 'hospedaje', 'traslado']
