import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import type { AddFileMaterialInput, Material } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_CONTENT_CHARS = 1_000_000

const TEXT_EXTS = new Set(['.txt', '.md', '.markdown'])
const requireModule = createRequire(import.meta.url)

function extractDocument(bytes: Buffer, ext: '.pdf' | '.docx'): Promise<{ text: string; pages?: number }> {
  return new Promise((resolve, reject) => {
    const modulePath = requireModule.resolve(ext === '.pdf' ? 'pdf-parse/lib/pdf-parse.js' : 'mammoth')
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const parser = require(workerData.modulePath);
        const bytes = Buffer.from(workerData.bytes);
        const result = workerData.ext === '.pdf' ? await parser(bytes) : await parser.extractRawText({ buffer: bytes });
        const text = result.text ?? result.value;
        if (text.length > 1000000) throw new Error('文档解析后超过 100 万字符，请拆分；未截断或保存内容');
        parentPort.postMessage({ text, pages: result.numpages });
      })().catch(error => parentPort.postMessage({ error: error.message }));
    `, { eval: true, workerData: { modulePath, bytes, ext }, resourceLimits: { maxOldGenerationSizeMb: 192 } })
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('文档解析超过 30 秒，请拆分或转换为 TXT')) }, 30_000)
    worker.once('message', result => { clearTimeout(timer); void worker.terminate(); result.error ? reject(new Error(result.error)) : resolve(result) })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('文档解析中断，请转换为 TXT 后重试')) })
  })
}

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
      const result = await extractDocument(bytes, '.pdf')
      text = result.text
      formatNote = `PDF · ${result.pages || '?'} 页`
    } else if (ext === '.docx') {
      const result = await extractDocument(bytes, '.docx')
      text = result.text
      formatNote = 'Word 文档'
    } else {
      throw new Error('仅支持上传 TXT / Markdown / PDF / Word(.docx) 文档')
    }

    text = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
    if (!text) throw new Error('文档解析结果为空：可能是扫描版 PDF 或空文档')
    if (text.length > MAX_CONTENT_CHARS) throw new Error('文档解析后超过 100 万字符，请拆分；未截断或保存内容')

    return this.database.addFileMaterial({
      fileName,
      content: text,
      relatedTopicId: input.relatedTopicId,
      formatNote
    })
  }
}
