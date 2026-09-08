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
}

const TEXTOS = {
  [MOTIVO.TIMEOUT]: 'El servicio tardó más de lo aceptable en responder.',
  [MOTIVO.ERROR]: 'El servicio devolvió un error.',
  [MOTIVO.CIRCUITO_ABIERTO]:
    'El servicio viene fallando: dejamos de consultarlo por unos minutos.',
  [MOTIVO.APAGADO_POR_ADMIN]:
    'Un administrador desactivó esta sección temporalmente.',
  [MOTIVO.DESACTIVADO_POR_USUARIO]:
    'Ocultaste esta sección en tus preferencias.',
  [MOTIVO.CAMPOS_INSUFICIENTES]:
    'Esta búsqueda no tiene los datos que este servicio necesita.',
}

export function textoDeMotivo(motivo) {
  return TEXTOS[motivo] ?? 'El servicio no está disponible en este momento.'
}
