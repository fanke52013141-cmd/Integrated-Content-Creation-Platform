/** 备份与恢复期间拒绝新的 IPC 操作；已有操作进行时要求稍后重试。 */
export class OperationGate {
  private active = 0
  private exclusive = false

  async run<T>(operation: () => T | Promise<T>, exclusive = false): Promise<T> {
    if (this.exclusive) throw new Error('正在备份或恢复数据，请稍后再操作')
    if (exclusive && this.active > 0) throw new Error('还有操作进行中，请等待生成、暂存或上传完成后再备份或恢复')
    this.active += 1
    if (exclusive) this.exclusive = true
    try { return await operation() }
    finally { this.active -= 1; if (exclusive) this.exclusive = false }
  }
}
