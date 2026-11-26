const clone = value => JSON.parse(JSON.stringify(value))
const TERMINAL = new Set(['completed', 'failed', 'blocked', 'cancelled', 'canceled'])

export class DeliveryController {
  constructor({ client, onChange = () => {}, pollIntervalMs = 1500, maxPolls = 60 } = {}) {
    this.client = client
    this.onChange = onChange
    this.pollIntervalMs = pollIntervalMs
    this.maxPolls = maxPolls
    this.state = { enabled: false, status: 'idle', key: null, record: null, error: null }
    this.busy = false
    this.queued = null
  }

  notify() { this.onChange(clone(this.state)) }

  setEnabled(enabled) {
    this.state.enabled = Boolean(enabled)
    this.state.error = null
    if (!enabled) this.queued = null
    if (!this.state.key) this.state.status = enabled ? 'enabled' : 'idle'
    this.notify()
  }

  async submit(document, accountId) {
    if (this.busy) {
      this.queued = { document: clone(document), accountId }
      return { queued: true }
    }
    if (!accountId) {
      this.state.status = 'error'
      this.state.error = '请选择服务端返回的公众号账号'
      this.notify()
      return { ok: false, error: this.state.error }
    }
    this.busy = true
    this.state.status = 'submitting'
    this.state.error = null
    this.notify()
    try {
      const response = await this.client.submitDelivery(document, { accountId })
      const record = response.record
      if (!record?.key) throw new Error('后端未返回交付任务 key')
      this.state.key = record.key
      this.state.record = record
      this.state.status = String(record.status || 'submitted').toLowerCase()
      this.notify()
      if (TERMINAL.has(this.state.status)) return this.finish(record)
      return await this.poll(record.key)
    }
    catch (error) {
      this.state.status = 'error'
      this.state.error = error.message || String(error)
      this.busy = false
      this.notify()
      return { ok: false, error: this.state.error }
    }
  }

  async poll(key = this.state.key) {
    if (!key) return { ok: false, error: '没有可查询的交付任务' }
    this.busy = true
    this.state.status = 'checking'
    this.state.error = null
    this.notify()
    try {
      for (let attempt = 0; attempt < this.maxPolls; attempt += 1) {
        const response = await this.client.delivery(key)
        if (!response.record) throw new Error('后端未返回交付记录')
        this.state.record = response.record
        this.state.status = String(response.record.status || 'unknown').toLowerCase()
        this.notify()
        if (TERMINAL.has(this.state.status)) return this.finish(response.record)
        if (this.pollIntervalMs > 0) await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs))
      }
      this.state.status = 'unknown'
      this.state.error = '任务尚未到达终态；可稍后刷新，不能据此认定草稿成功'
      this.busy = false
      this.notify()
      return { ok: false, error: this.state.error }
    }
    catch (error) {
      this.state.status = 'error'
      this.state.error = error.message || String(error)
      this.busy = false
      this.notify()
      return { ok: false, error: this.state.error }
    }
  }

  finish(record) {
    this.busy = false
    this.state.record = record
    this.state.status = String(record.status || 'unknown').toLowerCase()
    this.notify()
    const queued = this.queued
    this.queued = null
    if (queued && this.state.enabled) return this.submit(queued.document, queued.accountId)
    return { ok: this.state.status === 'completed', record }
  }
}
