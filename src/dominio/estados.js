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
}

export function textoDeMotivo(motivo) {
  return TEXTOS[motivo] ?? 'El servicio no está disponible en este momento.'
}
