export class RendererError extends Error {
  constructor(message, { code = 'RENDER_FAILED', cause, details } = {}) {
    super(message, { cause })
    this.name = 'RendererError'
    this.code = code
    this.details = details
  }
}

export function asRendererError(error, code = 'RENDER_FAILED') {
  if (error instanceof RendererError) return error
  return new RendererError(error?.message ?? String(error), { code, cause: error })
}
