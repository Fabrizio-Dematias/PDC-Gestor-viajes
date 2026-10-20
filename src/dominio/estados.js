/**
 * Los tres estados en que puede estar un vertical. Ver
 * docs/contrato-agregador.md §5. Este enum es el mismo en front y back.
 */
export const ESTADO = {
  CARGANDO: 'loading',
  OK: 'ok',
  NO_DISPONIBLE: 'unavailable',
}

/** Motivos por los que un vertical queda en NO_DISPONIBLE. */
export const MOTIVO = {
  TIMEOUT: 'timeout',
  ERROR: 'error',
  CIRCUITO_ABIERTO: 'circuito_abierto',
  /** El registro de servicios sabe de este servicio pero ninguna de sus
   *  instancias está lista (no pasan su health check). */
  SIN_INSTANCIAS: 'sin_instancias',
  /** El servicio respondió, pero dijo que la búsqueda no tiene sentido
   *  (400): no es que no esté disponible, es que hay que cambiarla. */
  MISMO_LUGAR: 'mismo_lugar',
  LUGAR_DESCONOCIDO: 'lugar_desconocido',
  SOLICITUD_INVALIDA: 'solicitud_invalida',
  APAGADO_POR_ADMIN: 'apagado_por_admin',
  DESACTIVADO_POR_USUARIO: 'desactivado_por_usuario',
  /**
   * El único motivo que el backend nunca devuelve: lo decide
   * `Resultados.jsx` antes de pedir nada, cuando la búsqueda no trae
   * los campos que este vertical necesita (ej. vuelos sin `origen`
   * porque se buscó desde la solapa Hospedaje). Vive acá igual que los
   * otros dos "no se llega a pedir" para que `SeccionOculta` no
   * necesite un mecanismo aparte.
   */
  CAMPOS_INSUFICIENTES: 'campos_insuficientes',
  /**
   * Igual que CAMPOS_INSUFICIENTES (nunca lo devuelve el backend, lo
   * decide `Resultados.jsx` antes de pedir nada): esta búsqueda sí
   * tenía los campos que este vertical necesita, pero se pidió desde
   * la solapa de otro — ej. buscar "Vuelos" trae destino+ida, que
   * también le alcanzarían a Hospedaje, pero no fue lo que se eligió.
   */
  OTRA_PESTANA: 'otra_pestana',
}

const TEXTOS = {
  [MOTIVO.TIMEOUT]: 'El servicio tardó más de lo aceptable en responder.',
  [MOTIVO.ERROR]: 'El servicio devolvió un error.',
  [MOTIVO.CIRCUITO_ABIERTO]:
    'El servicio viene fallando: dejamos de consultarlo por unos minutos.',
  [MOTIVO.SIN_INSTANCIAS]: 'Ninguna instancia de este servicio está lista para atender.',
  [MOTIVO.MISMO_LUGAR]: 'El origen y el destino son la misma ciudad: elegí lugares distintos.',
  [MOTIVO.LUGAR_DESCONOCIDO]: 'No reconocemos el origen o el destino de esta búsqueda.',
  [MOTIVO.SOLICITUD_INVALIDA]: 'Revisá los datos de la búsqueda: alguno no es válido.',
  [MOTIVO.APAGADO_POR_ADMIN]:
    'Un administrador desactivó esta sección temporalmente.',
  [MOTIVO.DESACTIVADO_POR_USUARIO]:
    'Ocultaste esta sección en tus preferencias.',
  [MOTIVO.CAMPOS_INSUFICIENTES]:
    'Esta búsqueda no tiene los datos que este servicio necesita.',
  [MOTIVO.OTRA_PESTANA]: 'Buscaste desde otra pestaña.',
}

export function textoDeMotivo(motivo) {
  return TEXTOS[motivo] ?? 'El servicio no está disponible en este momento.'
}
