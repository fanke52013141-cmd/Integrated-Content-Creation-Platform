export class MemoryReceiptStore {
  #records = new Map()
  #locks = new Map()

  async load(key) {
    const record = this.#records.get(key)
    return record ? structuredClone(record) : null
  }

  async save(record) {
    this.#records.set(record.key, structuredClone(record))
    return structuredClone(record)
  }

  async list(filter = {}) {
    return [...this.#records.values()]
      .filter(record => !filter.channel || record.channel === filter.channel)
      .filter(record => !filter.status || record.status === filter.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(record => structuredClone(record))
  }

  async runExclusive(key, work) {
    const previous = this.#locks.get(key) ?? Promise.resolve()
    let release
    const current = new Promise(resolve => { release = resolve })
    const queued = previous.then(() => current)
    this.#locks.set(key, queued)
    await previous
    try { return await work() }
    finally {
      release()
      if (this.#locks.get(key) === queued) this.#locks.delete(key)
    }
  }
}
