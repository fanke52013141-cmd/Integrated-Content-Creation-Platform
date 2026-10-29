/** 备份与恢复期间拒绝新的 IPC 操作；已有操作进行时要求稍后重试。 */
export class OperationGate {
  private activeChannels = new Map<number, string>()
  private exclusive = false
  private sequence = 0

  async run<T>(operation: () => T | Promise<T>, exclusive = false, channel = ''): Promise<T> {
    if (this.exclusive) throw new Error('正在备份或恢复数据，请稍后再操作')
    if (exclusive && this.activeChannels.size > 0) {
      throw new Error(`还有 ${this.activeChannels.size} 个操作进行中（${this.describeActive()}），请等待它们完成后再备份或恢复`)
    }
    const ticket = ++this.sequence
    this.activeChannels.set(ticket, channel)
    if (exclusive) this.exclusive = true
    try { return await operation() }
    finally { this.activeChannels.delete(ticket); if (exclusive) this.exclusive = false }
  }

  /** 把正在进行的通道归并为用户能看懂的操作名，最多列 4 类，避免提示过长 */
  private describeActive(): string {
    const counts = new Map<string, number>()
    for (const channel of this.activeChannels.values()) {
      const label = describeChannel(channel)
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, count]) => count > 1 ? `${label} ×${count}` : label)
      .slice(0, 4)
      .join('、')
  }
}

const CHANNEL_LABELS: Record<string, string> = {
  'articles:generate': '文章生成',
  'articles:revise': '文章改稿',
  'topics:generate': '选题生成',
  'frameworks:generate': '框架生成',
  'reviews:start': '内容评审',
  'visuals:generate': '配图方案生成',
  'visuals:generate-image': '配图生成',
  'materials:search': '素材搜索',
  'app:backup-create': '数据备份',
  'app:backup-restore': '数据恢复',
  'app:backup-export-portable': '备份导出'
}

function describeChannel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? (channel.replace(/^[a-z]+:/, '') || '其他操作')
}
