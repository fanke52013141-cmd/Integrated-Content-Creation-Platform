import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import mammoth from 'mammoth'
import type { AddFileMaterialInput, Material } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_CONTENT_CHARS = 20_000

const TEXT_EXTS = new Set(['.txt', '.md', '.markdown'])

/**
 * 文件上传素材：txt/md 直读、pdf（pdf-parse）与 docx（mammoth）本地提取文本，
 * 不依赖任何外部 API；提取结果作为文字素材入库（origin = file_upload）。
 */
export class FileMaterialService {
  constructor(private readonly database: AppDatabase) {}

  async importFromUpload(input: AddFileMaterialInput): Promise<Material> {
    const fileName = input.fileName.trim()
    const dot = fileName.lastIndexOf('.')
    const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
    const bytes = Buffer.from(input.data)
    if (!bytes.length) throw new Error('文件内容为空')
    if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 10MB 上限，请拆分后再上传')

    let text: string
    let formatNote: string
    if (TEXT_EXTS.has(ext)) {
      text = bytes.toString('utf-8')
      formatNote = ext === '.txt' ? 'TXT' : 'Markdown'
    } else if (ext === '.pdf') {
      const result = await pdfParse(bytes)
      text = result.text
      formatNote = `PDF · ${result.numpages || '?'} 页`
    } else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer: bytes })
      text = result.value
      formatNote = 'Word 文档'
    } else {
      throw new Error('仅支持上传 TXT / Markdown / PDF / Word(.docx) 文档')
    }

    text = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
    if (!text) throw new Error('文档解析结果为空：可能是扫描版 PDF 或空文档')
    if (text.length > MAX_CONTENT_CHARS) {
      text = text.slice(0, MAX_CONTENT_CHARS) + '\n\n……（内容过长，已截断保存前 2 万字）'
    }

    return this.database.addFileMaterial({
      fileName,
      content: text,
      relatedTopicId: input.relatedTopicId,
      formatNote
    })
  }
}
