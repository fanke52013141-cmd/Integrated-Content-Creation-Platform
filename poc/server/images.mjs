import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

export function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg'
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'gif'
  return null
}

function readJpegDimensions(buffer) {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xFF) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > buffer.length) break
    const isStartOfFrame = [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)
    if (isStartOfFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return { width: null, height: null }
}

export function readImageDimensions(buffer, type = detectImageType(buffer)) {
  if (type === 'png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (type === 'jpg') return readJpegDimensions(buffer)
  if (type === 'gif' && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  return { width: null, height: null }
}

export async function readImageMetadata(filePath) {
  const [buffer, fileStat] = await Promise.all([readFile(filePath), stat(filePath)])
  const type = detectImageType(buffer)
  const dimensions = readImageDimensions(buffer, type)
  return {
    path: filePath,
    bytes: fileStat.size,
    type,
    ...dimensions,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
}

export async function assertArticleImage(filePath) {
  const metadata = await readImageMetadata(filePath)
  if (!['jpg', 'png'].includes(metadata.type)) {
    throw new Error(`正文图片只支持真实 JPG/PNG：${filePath}（检测为 ${metadata.type ?? '未知'}）`)
  }
  if (metadata.bytes <= 0 || metadata.bytes >= 1_000_000) {
    throw new Error(`正文图片必须大于 0 且小于 1,000,000 字节：${filePath}（${metadata.bytes}）`)
  }
  return metadata
}

export async function assertThumbnail(filePath) {
  const metadata = await readImageMetadata(filePath)
  if (metadata.type !== 'jpg') throw new Error(`封面缩略图只支持真实 JPG：${filePath}`)
  if (metadata.bytes <= 0 || metadata.bytes > 64 * 1024) {
    throw new Error(`封面缩略图必须大于 0 且不超过 64KiB：${filePath}（${metadata.bytes}）`)
  }
  return metadata
}

export function resolveInside(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`非法素材路径：${relativePath}`)
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`素材路径越界：${relativePath}`)
  }
  return resolved
}
