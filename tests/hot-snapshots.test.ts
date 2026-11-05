import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import type { HotItem } from '../src/shared/contracts.js'

/** 黑马检测（A1）的可信度测试：先证明快照落库与基线窗口计算能抓到已知的排名跃升 */
function hotItem(id: string, rank: number): HotItem {
  return {
    id, title: `条目-${id}`, desc: '', url: `https://example.com/${id}`,
    source: 'weibo', sourceTitle: '微博', subtitle: '热榜',
    updateTime: '2026-11-05T00:00:00.000Z', rank, rawJson: '{}'
  }
}

describe('热榜快照与黑马基线', () => {
  it('全部快照都在 90 分钟内时没有基线（新上榜不误报黑马）', () => {
    const db = new AppDatabase(':memory:')
    db.recordHotSnapshots('weibo', [hotItem('a', 20), hotItem('b', 5)])
    db.recordHotSnapshots('weibo', [hotItem('a', 3)])
    expect(db.getHotRankBaselines('weibo').size).toBe(0)
  })

  it('窗口外的旧快照参与基线，且取窗口内最新一次', () => {
    const db = new AppDatabase(':memory:')
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    db.recordHotSnapshots('weibo', [hotItem('a', 30)], threeHoursAgo)
    db.recordHotSnapshots('weibo', [hotItem('a', 20)], twoHoursAgo)
    db.recordHotSnapshots('weibo', [hotItem('a', 3)])
    const baselines = db.getHotRankBaselines('weibo')
    expect(baselines.get('a')).toBe(20)
  })

  it('不同平台快照互相隔离', () => {
    const db = new AppDatabase(':memory:')
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    db.recordHotSnapshots('weibo', [hotItem('a', 15)], twoHoursAgo)
    db.recordHotSnapshots('douyin', [hotItem('a', 1)])
    expect(db.getHotRankBaselines('weibo').get('a')).toBe(15)
    expect(db.getHotRankBaselines('douyin').size).toBe(0)
  })

  it('超过 48 小时的快照不参与基线（数据太旧，涨跃已无参考意义）', () => {
    const db = new AppDatabase(':memory:')
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    db.recordHotSnapshots('weibo', [hotItem('a', 40)], threeDaysAgo)
    expect(db.getHotRankBaselines('weibo').size).toBe(0)
  })

  it('黑马判定口径：基线排名 - 当前排名 ≥ 10 位', () => {
    const db = new AppDatabase(':memory:')
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    db.recordHotSnapshots('weibo', [hotItem('a', 20), hotItem('b', 20), hotItem('c', 20)], twoHoursAgo)
    db.recordHotSnapshots('weibo', [hotItem('a', 3), hotItem('b', 12), hotItem('c', 19)])
    const baselines = db.getHotRankBaselines('weibo')
    const surging = [...baselines.entries()]
      .filter(([itemId, baseline]) => baseline - 0 >= 0 && (baseline - ({ a: 3, b: 12, c: 19 } as Record<string, number>)[itemId]!) >= 10)
      .map(([itemId]) => itemId)
    expect(surging).toEqual(['a'])
  })
})
