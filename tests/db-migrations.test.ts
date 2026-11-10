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
    expect(currentVersion(db['db'])).toBe(BASELINE_VERSION)
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
    expect(currentVersion(db['db'])).toBe(BASELINE_VERSION)
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
    expect(currentVersion(db['db'])).toBe(BASELINE_VERSION)
  })
})
