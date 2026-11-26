function clone(value) {
  return value == null ? value : structuredClone(value)
}

/**
 * Reference store used by tests and local POCs. Production stores must preserve
 * the same contract with durable writes and a cross-process per-key lock.
 */
export class MemoryDeliveryStore {
  #records = new Map()
  #locks = new Map()

  async load(key) {
    return clone(this.#records.get(key) ?? null)
  }

  async save(record) {
    if (!record?.key) throw new TypeError('Delivery record requires a key')
    this.#records.set(record.key, clone(record))
    return clone(record)
  }

  async runExclusive(key, work) {
    const previous = this.#locks.get(key) ?? Promise.resolve()
    let release
    const current = new Promise(resolve => { release = resolve })
    this.#locks.set(key, current)
    await previous
    try {
      return await work()
    }
    finally {
      release()
      if (this.#locks.get(key) === current) this.#locks.delete(key)
    }
  }

  async keys() {
    return [...this.#records.keys()]
  }

  async dump() {
    return clone(Object.fromEntries(this.#records))
  }
}
