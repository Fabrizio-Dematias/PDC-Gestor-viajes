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

  /** Presupuesto de tiempo por tramo. Ver docs/contrato-agregador.md §3. */
  timeouts: {
    /** Agregador → vertical. */
    vertical: n(process.env.TIMEOUT_VERTICAL_MS, 2500),
    /** Vertical → Amadeus. Se corta antes que el de arriba a propósito. */
    amadeus: n(process.env.TIMEOUT_AMADEUS_MS, 1800),
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
}

export const VERTICALES = ['vuelos', 'hospedaje']
