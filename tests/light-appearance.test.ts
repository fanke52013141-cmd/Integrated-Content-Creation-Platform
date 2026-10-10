import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/renderer/public/theme-init.js', 'utf8')

describe('浅色首屏初始化', () => {
  it('清除旧的深色偏好，并固定原生控件的浅色外观', () => {
    const root = { dataset: { theme: 'dark' }, style: { colorScheme: 'dark' } }
    const storage = new Map([['moliu:theme', 'dark'], ['moliu:work', 'saved']])
    runInNewContext(source, {
      document: { documentElement: root },
      localStorage: { removeItem: (key: string) => storage.delete(key) }
    })
    expect(root.dataset.theme).toBe('light')
    expect(root.style.colorScheme).toBe('light')
    expect(storage.has('moliu:theme')).toBe(false)
    expect(storage.get('moliu:work')).toBe('saved')
  })

  it('存储不可用时仍保持浅色首屏', () => {
    const root = { dataset: { theme: 'dark' }, style: { colorScheme: 'dark' } }
    runInNewContext(source, {
      document: { documentElement: root },
      localStorage: { removeItem: () => { throw new Error('Storage unavailable') } }
    })
    expect(root.dataset.theme).toBe('light')
    expect(root.style.colorScheme).toBe('light')
  })
})
