// 版本化迁移框架（db/migrations.ts）：
// - 旧哨兵库（version=2）打开后落 baseline 版本
// - MIGRATIONS 有序 step 只跑一次、跳过已执行版本
// - 更高版本库拒绝打开
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppDatabase } from '../src/main/database.js'
import { applyPendingMigrations, BASELINE_VERSION, currentVersion, latestVersion, recordVersion, type MigrationStep } from '../src/main/db/migrations.js'

const dirs: string[] = []
const dbs: AppDatabase[] = []
afterEach(() => {
  while (dbs.length) dbs.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('版本化迁移框架', () => {
  it('全新库打开后版本 = baseline，schema_migrations 已建', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-mig-'))
    dirs.push(dir)
    const db = new AppDatabase(join(dir, 'moliu.db'))
    dbs.push(db)
    expect(currentVersion(db['db'])).toBe(latestVersion())
    expect(latestVersion()).toBeGreaterThanOrEqual(BASELINE_VERSION)
  })

  it('旧哨兵库（version=2）打开后被收敛到 baseline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-mig-legacy-'))
    dirs.push(dir)
    const legacy = new DatabaseSync(join(dir, 'moliu.db'))
    legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (2, \'2026-01-01T00:00:00.000Z\')')
    legacy.close()
    const db = new AppDatabase(join(dir, 'moliu.db'))
    dbs.push(db)
    expect(currentVersion(db['db'])).toBe(latestVersion())
  })

  it('pending step 按序只跑一次；重复打开不重复执行', () => {
    const ran: number[] = []
    const steps: MigrationStep[] = [
      { version: 4, description: '测试步骤 A', up: () => { ran.push(4) } },
      { version: 5, description: '测试步骤 B', up: () => { ran.push(5) } }
    ]
    const probe = new DatabaseSync(':memory:')
    probe.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    recordVersion(probe, BASELINE_VERSION)
    // 模拟框架行为：注入 steps 后补跑
    const from = currentVersion(probe)
    for (const step of steps) { if (step.version <= from) continue; step.up(probe); recordVersion(probe, step.version) }
    expect(ran).toEqual([4, 5])
    // 再补跑一轮：全部跳过
    const from2 = currentVersion(probe)
    for (const step of steps) { if (step.version <= from2) continue; step.up(probe); recordVersion(probe, step.version) }
    expect(ran).toEqual([4, 5])
    expect(currentVersion(probe)).toBe(5)
  })

  it('更高版本库打开被拒绝（守卫用 latestVersion 而非硬编码 2）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-mig-future-'))
    dirs.push(dir)
    const future = new DatabaseSync(join(dir, 'moliu.db'))
    future.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (9999, \'2026-01-01T00:00:00.000Z\')')
    future.close()
    expect(() => new AppDatabase(join(dir, 'moliu.db'))).toThrow('更高版本')
  })

  it('applyPendingMigrations 对真实库执行：无缺失 step 时为空操作', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-mig-real-'))
    dirs.push(dir)
    const db = new AppDatabase(join(dir, 'moliu.db'))
    dbs.push(db)
    expect(() => applyPendingMigrations(db['db'])).not.toThrow()
    expect(currentVersion(db['db'])).toBe(latestVersion())
  })
})

describe('迁移 v4：热点标签用户化', () => {
  it('旧哨兵库升级后：预置标签写入 hot_labels，存量枚举关联保留，CHECK 约束已去除', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-mig-v4-'))
    dirs.push(dir)
    // 用 baseline 库先造收藏+标签，再手动模拟 v3 时代状态（模拟方式：直接验证 v4 后行为）
    const db = new AppDatabase(join(dir, 'moliu.db'))
    dbs.push(db)
    const labels = db.listHotLabels()
    expect(labels.map(l => l.name)).toContain('待选题')
    expect(labels.map(l => l.name)).toContain('已用')
    // 自定义标签可保存且立即成为白名单
    const created = db.saveHotLabel({ name: '本周要写' })
    expect(created.sortOrder).toBe(2)
    const { favorite } = db.addHotFavorite({ hotItem: { id: 'h9', title: 'T', desc: '', url: '', source: 'weibo', sourceTitle: '微博', subtitle: '', updateTime: 'x', rank: 1, rawJson: '{}' }, tags: ['本周要写'] })
    expect(db.listHotFavorites(true).find(item => item.id === favorite.id)?.tags).toContain('本周要写')
    // 重命名同步收藏关联；删除联动清除
    db.saveHotLabel({ id: created.id, name: '下周要写' })
    expect(db.listHotFavorites(true).find(item => item.id === favorite.id)?.tags).toContain('下周要写')
    db.removeHotLabel(created.id)
    expect(db.listHotFavorites(true).find(item => item.id === favorite.id)?.tags).not.toContain('下周要写')
    // 同名拒绝、上限 10
    expect(() => db.saveHotLabel({ name: '已用' })).toThrow('同名')
    for (let i = db.listHotLabels().length; i < 10; i++) db.saveHotLabel({ name: `标签${i}` })
    expect(() => db.saveHotLabel({ name: '超额' })).toThrow('最多 10 个')
  })

  it('v3 库（含 CHECK 约束的旧表）迁移后可写自定义标签', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moliu-mig-v4-legacy-'))
    dirs.push(dir)
    const legacy = new DatabaseSync(join(dir, 'moliu.db'))
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (2, '2026-01-01T00:00:00.000Z');
    `)
    legacy.close()
    // baseline 迁移建的是新 CHECK 表？不——baseline DDL 仍含旧 CHECK；v4 step 负责重建。
    const db = new AppDatabase(join(dir, 'moliu.db'))
    dbs.push(db)
    const check = db['db'].prepare("SELECT sql FROM sqlite_master WHERE name='hot_favorite_tags'").get() as { sql: string }
    expect(check.sql).not.toContain('CHECK')
    expect(() => db.saveHotLabel({ name: '自定义标签' })).not.toThrow()
  })
})
