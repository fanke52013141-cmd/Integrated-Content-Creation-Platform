import { describe, expect, it } from 'vitest'
import { parseAccountJson } from '../src/main/services/account-generator.js'

const validAccount = {
  账号名称: '量子观察者',
  简介: '用大白话讲科技',
  领域: '科技科普',
  目标受众: '非专业成年人',
  写作风格: '轻松、准确',
  IP人设: '好奇的朋友',
  差异化定位: '不堆术语',
  价值主张: '每天搞懂一个科技概念'
}

describe('parseAccountJson', () => {
  it('parses a plain JSON object', () => {
    expect(parseAccountJson(JSON.stringify(validAccount))).toEqual(validAccount)
  })

  it('parses a fenced response', () => {
    expect(parseAccountJson(`结果如下：\n\`\`\`json\n${JSON.stringify(validAccount)}\n\`\`\``))
      .toEqual(validAccount)
  })

  it('unwraps an account object', () => {
    expect(parseAccountJson(JSON.stringify({ 账号定位: validAccount }))).toEqual(validAccount)
  })

  it('rejects incomplete fields', () => {
    expect(() => parseAccountJson('{"账号名称":"只有一个字段"}')).toThrow('八字段')
  })
})
