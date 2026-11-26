import { RendererError } from './errors.mjs'

export async function withTimeout(promise, timeoutMs, message = 'Chromium render timed out') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RendererError(message, {
      code: 'RENDER_TIMEOUT',
      details: { timeoutMs },
    })), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  }
  finally {
    clearTimeout(timer)
  }
}
