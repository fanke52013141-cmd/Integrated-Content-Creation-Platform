import { describe, expect, it } from 'vitest'
import { imageDimensionsFromBuffer } from '../src/main/services/wechat-publish-service.js'

/**
 * data-w 依赖的图片尺寸解析测试。
 *
 * 构造的是"合法头部"而非完整图片：解析器只读头部字段，
 * 用最小字节串验证偏移与大端序的正确性，不需要真实图片文件。
 */

/** 8 字节签名 + IHDR：长度(4) + "IHDR"(4) + 宽(4) + 高(4) */
function makePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

/** SOI + SOF0 段：FFD8 + FFC0 + 段长(2) + 精度(1) + 高(2) + 宽(2) */
function makeJpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(19)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x00], 0)
  bytes[7] = (height >> 8) & 0xff
  bytes[8] = height & 0xff
  bytes[9] = (width >> 8) & 0xff
  bytes[10] = width & 0xff
  return bytes
}

describe('图片尺寸解析（data-w 依据）', () => {
  it('解析 PNG 头部的大端序宽高', () => {
    expect(imageDimensionsFromBuffer(makePng(1080, 608))).toEqual({ width: 1080, height: 608 })
  })

  it('解析 JPEG SOF 段的高宽（注意 JPEG 是先高后宽）', () => {
    expect(imageDimensionsFromBuffer(makeJpeg(750, 1334))).toEqual({ width: 750, height: 1334 })
  })

  it('非 PNG/JPEG 字节返回 null，不抛错', () => {
    expect(imageDimensionsFromBuffer(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull()
  })

  it('截断的头部返回 null（不越界读取）', () => {
    expect(imageDimensionsFromBuffer(makePng(100, 100).slice(0, 10))).toBeNull()
  })
})
