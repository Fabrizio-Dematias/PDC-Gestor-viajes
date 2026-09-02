/**
 * Cliente HTTP entre servicios. Es el único lugar del backend donde se
 * hace una llamada saliente, y por eso es el único que necesita saber de
 * timeouts.
 */

export class LlamadaFallida extends Error {
  constructor(motivo, causa) {
    super(`llamada fallida: ${motivo}`)
    this.name = 'LlamadaFallida'
    this.motivo = motivo // 'timeout' | 'error'
    this.causa = causa
  }
}

/**
 * GET/PUT con corte por `AbortController`.
 *
 * El timeout no es opcional: un servicio *colgado* —que acepta la
 * conexión y nunca responde— dejaría la promesa viva para siempre y con
 * ella la búsqueda del usuario. `fetch` sin señal no vuelve nunca.
 */
export async function pedirJson(url, { timeoutMs, metodo = 'GET', cuerpo, headers } = {}) {
  const control = new AbortController()
  const cortar = timeoutMs
    ? setTimeout(() => control.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
    : null

  try {
    const res = await fetch(url, {
      method: metodo,
      signal: control.signal,
      headers: {
        ...(cuerpo ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    })
    const datos = await res.json().catch(() => null)
    return { ok: res.ok, estado: res.status, datos }
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new LlamadaFallida('timeout', error)
    throw new LlamadaFallida('error', error)
  } finally {
    if (cortar) clearTimeout(cortar)
  }
}
