import { RendererError } from './errors.mjs'

/** A rejection is isolated from the next task; close drains all accepted work. */
export class SerialTaskQueue {
  #tail = Promise.resolve()
  #accepting = true
  #pending = 0
  #closePromise = null

  get pending() {
    return this.#pending
  }

  get accepting() {
    return this.#accepting
  }

  run(work) {
    if (!this.#accepting) {
      return Promise.reject(new RendererError('Renderer is closing or closed', { code: 'RENDERER_CLOSED' }))
    }
    this.#pending += 1
    const result = this.#tail.then(work)
    this.#tail = result.catch(() => {}).finally(() => { this.#pending -= 1 })
    return result
  }

  close(dispose) {
    if (this.#closePromise) return this.#closePromise
    this.#accepting = false
    this.#closePromise = this.#tail.then(dispose)
    return this.#closePromise
  }
}
