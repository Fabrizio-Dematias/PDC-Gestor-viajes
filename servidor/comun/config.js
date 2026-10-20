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
  /** Consumidor de la cola de reservas (Módulo 3): "envía" las
   *  confirmaciones. Es un proceso aparte a propósito — puede estar
   *  caído sin que la reserva lo note. */
  notificaciones: {
    puerto: n(process.env.PUERTO_NOTIFICACIONES, 4005),
    url: process.env.URL_NOTIFICACIONES ?? 'http://localhost:4005',
  },
  /** Registro de servicios (Módulo 4): quién está vivo y dónde. */
  registro: {
    puerto: n(process.env.PUERTO_REGISTRO, 4006),
    url: process.env.URL_REGISTRO ?? 'http://localhost:4006',
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
    // Con el Postgres en Supabase, abrir una conexión nueva (TLS + pooler)
    // cuesta ~1,5 s medidos desde acá, contra ~0,25 s de una consulta en
    // una conexión ya abierta. El pool cierra las conexiones ociosas a los
    // 10 s por defecto, así que una búsqueda cada tanto pagaba la
    // conexión entera *antes de llamar siquiera a vuelos*. Se mantiene
    // una abierta (`min`), se la deja vivir más (`idleTimeoutMillis`) y se
    // pide keep-alive de TCP para que el pooler no la corte por callada.
    min: n(process.env.PG_MIN, 1),
    idleTimeoutMillis: n(process.env.PG_IDLE_MS, 5 * 60_000),
    keepAlive: true,
    connectionTimeoutMillis: n(process.env.PG_CONNECT_MS, 8000),
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
    /** Agregador → vuelos. Con una API externa de por medio (Duffel:
     *  1,5 a 3,5 s por búsqueda, medidos) el presupuesto de 2,5 s del
     *  resto dejaba "no disponible por timeout" a una búsqueda que iba
     *  perfecto, así que vuelos tiene el suyo. Se deduce de `PROVEEDOR`,
     *  que el agregador tiene que ver igual que el servicio de vuelos
     *  (con `npm run back` es el mismo `.env`; en contenedores, la misma
     *  variable en los dos). Sigue valiendo "cada capa se corta antes que
     *  la de arriba": Duffel 5 s < agregador 5,5 s < front 6 s. */
    vuelos: n(process.env.TIMEOUT_VUELOS_MS, ['duffel', 'amadeus'].includes(process.env.PROVEEDOR) ? 5500 : 2500),
    /** Vertical → Amadeus/Duffel. Se corta antes que el de arriba a
     *  propósito — salvo Duffel, ver la nota en su valor. */
    amadeus: n(process.env.TIMEOUT_AMADEUS_MS, 1800),
    /** Medido contra la API real (`return_offers=true`, búsqueda
     *  síncrona contra varias aerolíneas de prueba): entre 1.6 s y
     *  3.4 s. Con el valor por defecto de arriba (2500 ms) para
     *  agregador→vertical, esto va a superar ese presupuesto con
     *  cierta frecuencia — el corte real, en ese caso, lo termina
     *  haciendo el agregador antes que Duffel mismo. Este valor más
     *  alto importa cuando se llama a `vuelos` directo (sin pasar por
     *  el agregador), como en la demo por `curl` del contrato §2.
     *  Ver docs/proveedor-externo.md. */
    duffel: n(process.env.TIMEOUT_DUFFEL_MS, 5000),
    /** Agregador → usuarios (perfil/config/login/registro). Corto por
     *  defecto porque asume Postgres local (Docker); con Postgres
     *  alojado (Supabase u otro) el round-trip de red por sí solo puede
     *  superar 1200 ms, así que hay que subirlo por env en ese caso. */
    contexto: n(process.env.TIMEOUT_CONTEXTO_MS, 1200),
  },

  /**
   * Qué implementación de ProveedorDeX usa cada vertical.
   * `ficticio` lee de la base propia; `amadeus`/`duffel` pegan contra
   * la API real correspondiente (docs/proveedor-externo.md).
   */
  proveedor: process.env.PROVEEDOR ?? 'ficticio',

  amadeus: {
    clave: process.env.AMADEUS_CLIENT_ID,
    secreto: process.env.AMADEUS_CLIENT_SECRET,
    base: process.env.AMADEUS_BASE ?? 'https://test.api.amadeus.com',
    moneda: process.env.AMADEUS_MONEDA ?? 'ARS',
  },

  duffel: {
    token: process.env.DUFFEL_ACCESS_TOKEN,
    base: process.env.DUFFEL_BASE ?? 'https://api.duffel.com',
  },

  /**
   * Canal asíncrono de reservas (Redis Streams). El agregador publica un
   * evento por reserva confirmada y el servicio de notificaciones, que
   * es un grupo de consumidores, lo procesa cuando puede.
   */
  colas: {
    stream: process.env.STREAM_RESERVAS ?? 'reservas:eventos',
    grupo: process.env.GRUPO_NOTIFICACIONES ?? 'notificaciones',
    /** Un mensaje leído y no confirmado (XACK) más de este tiempo se
     *  considera de un consumidor que murió a mitad de camino y se
     *  reclama para reintentarlo. */
    reclamarTrasMs: n(process.env.COLA_RECLAMAR_MS, 3000),
    /** Cada cuánto se miran los pendientes. */
    sondeoPendientesMs: n(process.env.COLA_SONDEO_MS, 1000),
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

/** Cuánto espera el agregador a cada vertical antes de darlo por caído. */
export const presupuestoDe = (vertical) => CONFIG.timeouts[vertical] ?? CONFIG.timeouts.vertical

/** Servicios que se registran en el registro de servicios y que el
 *  agregador descubre por nombre (servidor/comun/descubrimiento.js). */
export const SERVICIOS = ['vuelos', 'hospedaje', 'traslado', 'usuarios', 'notificaciones']
