import type { DatabaseSync } from 'node:sqlite'

/**
 * 版本化迁移框架（工程债批次 5）。
 *
 * 历史背景：schema_migrations 表此前只有哨兵值（version=2），实际迁移 = 一个巨型幂等 DDL 块
 * + ensureAddedColumns 硬编码补列清单 + 若干 ad-hoc 数据搬迁函数。这套机制只能加列/加表，
 * 无法改列/重建表，且每次 schema 演进都要往清单里堆代码。
 *
 * 新机制：
 * - 现状整条幂等管线收敛为 baseline（version 3）：打开任何旧库都先完整执行一遍幂等 DDL
 *   与历史数据搬迁（与旧行为完全一致），然后落版本号 3。
 * - 此后的 schema 演进一律在 MIGRATIONS 追加有序 step（version 4、5、…），每个 step 只跑一次：
 *   打开时读 schema_migrations 的 MAX(version)，按序执行缺失的 step 并逐个记录版本号。
 * - step 必须幂等（防手滑重复执行）且自带降级说明；改列/重建表从此有了正规通道。
 * - 打开旧库前的 .pre-optimization 备份与「更高版本拒绝打开」守卫保持不变。
 */

export interface MigrationStep {
  /** 目标版本号：严格递增，从 4 开始（3 = baseline） */
  version: number
  /** 一步做什么（进交接文档与代码评审） */
  description: string
  up(db: DatabaseSync): void
}

/**
 * baseline 之后的数据/schema 演进步骤（按 version 升序执行）。
 * 示例（热点自定义标签，等本框架落地后第一个接入）：
 *   { version: 4, description: '热点标签从固定枚举改为用户标签表', up(db) { …重建 hot_favorite_tags… } }
 */
export const MIGRATIONS: MigrationStep[] = []

/** baseline 版本号：与现有幂等管线绑定，演进时递增 MIGRATIONS 的最后一项 version */
export const BASELINE_VERSION = 3

/** 当前库应处的最新版本（baseline + 已登记 steps） */
export function latestVersion(): number {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : BASELINE_VERSION
}

/** 读库当前版本：无表（全新库/旧哨兵库）按 0 处理，由调用方先跑 baseline 再补 step */
export function currentVersion(db: DatabaseSync): number {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get()
  if (!table) return 0
  return Number(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version ?? 0)
}

/** 落版本号（幂等：同版本重复落不报错） */
export function recordVersion(db: DatabaseSync, version: number): void {
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version, new Date().toISOString())
}

/**
 * 打开库时执行：baseline 由调用方（AppDatabase.migrate）负责——它承载全部幂等 DDL 与
 * 历史搬迁；本函数只负责按序补跑缺失的 steps。
 * 「库版本 > 应用支持版本」的守卫在 baseline 之前由调用方用 latestVersion() 检查。
 */
export function applyPendingMigrations(db: DatabaseSync): void {
  const from = currentVersion(db)
  for (const step of MIGRATIONS) {
    if (step.version <= from) continue
    step.up(db)
    recordVersion(db, step.version)
  }
}
