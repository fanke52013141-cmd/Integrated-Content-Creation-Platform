/**
 * 生图/改图的像素尺寸换算。
 *
 * 生成接口走比例（gpt-image-2 系列），改图接口（/images/edits）实测只吃像素尺寸：
 * 中文 + `1024x1024` 的编辑请求能成功，传 `1:1` 会一直卡住。这里按比例给出 1K 档像素。
 */
const PIXELS: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x864',
  '9:16': '864x1536',
  '4:3': '1024x768',
  '3:4': '768x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '5:4': '1280x1024',
  '4:5': '1024x1280',
  '21:9': '2016x864'
}

/** 比例 → 1K 档像素；未知比例返回 undefined（改图时不传 size，由供应商决定） */
export function pixelSizeForRatio(ratio?: string, resolution: '1k' | '2k' | '4k' = '1k'): string | undefined {
  const normalized = ratio?.trim().replace(/\s/g, '')
  const base = normalized ? PIXELS[normalized] : undefined
  if (!base || resolution === '1k') return base
  const scale = resolution === '2k' ? 2 : 4
  return base.split('x').map(value => Number(value) * scale).join('x')
}
