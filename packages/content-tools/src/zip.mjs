import { inflateRawSync } from 'node:zlib'
import { ContentImportError } from './errors.mjs'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(input) {
  const bytes = Buffer.from(input)
  let crc = 0xFFFFFFFF
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

export function readZipEntries(input, {
  maxEntries = 2048,
  maxEntryBytes = 32 * 1024 * 1024,
  maxTotalBytes = 64 * 1024 * 1024,
} = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (bytes.length < 22) throw invalid('ZIP file is too small', 'DOCX_ZIP_INVALID')
  let eocd = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054B50) { eocd = offset; break }
  }
  if (eocd < 0) throw invalid('ZIP end record was not found', 'DOCX_ZIP_INVALID')
  if (bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) {
    throw invalid('Multi-disk ZIP files are not supported', 'DOCX_ZIP_UNSUPPORTED')
  }
  const count = bytes.readUInt16LE(eocd + 10)
  const centralSize = bytes.readUInt32LE(eocd + 12)
  const centralOffset = bytes.readUInt32LE(eocd + 16)
  if (count === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) {
    throw invalid('ZIP64 DOCX files are not supported by the dependency-free importer', 'DOCX_ZIP_UNSUPPORTED')
  }
  if (count > maxEntries) throw invalid('ZIP has too many entries', 'DOCX_LIMIT_EXCEEDED')
  if (centralOffset + centralSize > eocd) throw invalid('ZIP central directory is out of bounds', 'DOCX_ZIP_INVALID')
  const entries = new Map()
  let cursor = centralOffset
  let totalBytes = 0
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014B50) {
      throw invalid('ZIP central entry is malformed', 'DOCX_ZIP_INVALID')
    }
    const flags = bytes.readUInt16LE(cursor + 8)
    const method = bytes.readUInt16LE(cursor + 10)
    const expectedCrc = bytes.readUInt32LE(cursor + 16)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const uncompressedSize = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength
    if (flags & 1) throw invalid(`Encrypted ZIP entry is not supported: ${name}`, 'DOCX_ZIP_UNSUPPORTED')
    if (![0, 8].includes(method)) throw invalid(`Unsupported ZIP compression method ${method}: ${name}`, 'DOCX_ZIP_UNSUPPORTED')
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) {
      throw invalid(`Unsafe ZIP entry path: ${name}`, 'DOCX_ZIP_UNSAFE_PATH')
    }
    if (uncompressedSize > maxEntryBytes) throw invalid(`ZIP entry is too large: ${name}`, 'DOCX_LIMIT_EXCEEDED')
    totalBytes += uncompressedSize
    if (totalBytes > maxTotalBytes) throw invalid('DOCX uncompressed size exceeds the configured limit', 'DOCX_LIMIT_EXCEEDED')
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034B50) {
      throw invalid(`ZIP local entry is malformed: ${name}`, 'DOCX_ZIP_INVALID')
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    if (dataOffset + compressedSize > bytes.length) throw invalid(`ZIP entry data is out of bounds: ${name}`, 'DOCX_ZIP_INVALID')
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize)
    let data
    try {
      data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(uncompressedSize, 1) })
    }
    catch (cause) {
      throw invalid(`Unable to decompress ZIP entry: ${name}`, 'DOCX_ZIP_INVALID', cause)
    }
    if (data.length !== uncompressedSize || crc32(data) !== expectedCrc) {
      throw invalid(`ZIP entry checksum mismatch: ${name}`, 'DOCX_ZIP_INVALID')
    }
    if (!entries.has(name)) entries.set(name, data)
  }
  return entries
}

function invalid(message, code, cause) {
  return new ContentImportError(message, { code, cause })
}
