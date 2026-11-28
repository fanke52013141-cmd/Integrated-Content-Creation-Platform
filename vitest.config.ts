import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 多文件并发跑 SQLite 迁移/备份用例时，Windows 磁盘 I/O 偶发超过 5s 默认阈值
    testTimeout: 15_000
  }
})
