/**
 * Binds operational configuration once. A new document needs only submit(),
 * never a sequence of render/upload/draft interactions.
 */
export class DraftDeliveryService {
  constructor({ machine, theme, account, renderer }) {
    if (!machine?.deliver || !machine?.resume) throw new TypeError('A DeliveryMachine is required')
    this.machine = machine
    this.defaults = { theme, account, renderer }
  }

  submit(document, overrides = {}) {
    return this.machine.deliver({
      document,
      theme: overrides.theme ?? this.defaults.theme,
      account: overrides.account ?? this.defaults.account,
      renderer: overrides.renderer ?? this.defaults.renderer,
    })
  }

  deliver(input) {
    return this.machine.deliver({
      ...this.defaults,
      ...input,
      document: input.document,
    })
  }

  resume(key, options) {
    return this.machine.resume(key, options)
  }

  get(key) {
    return this.machine.get(key)
  }
}
