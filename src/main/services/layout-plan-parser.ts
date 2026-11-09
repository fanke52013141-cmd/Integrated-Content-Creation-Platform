import type { LayoutPlan, LayoutPlanInsertion } from '../../shared/contracts.js'

/**
 * `<排版方案>` 纯文本解析器（PRD-排版AI §4.1）。
 *
 * 模型输出是「键：值」行式纯文本而非 JSON——这是 PRD 的明确约定，容错空间比 JSON 大：
 * 逐行扫描、字段全部可选、分隔符兼容全角/半角。任何解析问题都不阻断排版：
 * 未知字段忽略、越界锚点收敛、未知图片丢弃并记入 warnings，最差得到一份空方案
 * （等价于无 AI 编排的纯文字排版路径）。
 */

export interface LayoutPlanAssetOption {
  fileName: string
  kind: 'cover' | 'inline'
  alt: string
}

export interface ParseLayoutPlanOptions {
  /** 输入里给模型的候选图片池；方案引用的文件名必须在这里面，否则丢弃 */
  knownAssets: LayoutPlanAssetOption[]
  /** 可用主题 id 池；推荐主题不在池内时撤下推荐、保留理由 */
  knownThemeIds: Array<{ id: string }>
  /** 当前正文段落总数（不含标题），用于收敛 after-paragraph 锚点 */
  paragraphCount: number
}

const SEPARATOR = /[｜|]/

/** 「第2段之后 / 文首 / 结尾之前 / 文末 / 开头」→ 结构化锚点 */
function parseAnchor(text: string, paragraphCount: number, warnings: string[]): Pick<LayoutPlanInsertion, 'anchor' | 'paragraph'> {
  const value = text.trim()
  if (/^(文首|开头|标题下|导读后)$/.test(value)) return { anchor: 'leading' }
  if (/^(结尾之前|文末|末尾|结尾)$/.test(value)) return { anchor: 'before-ending' }
  const match = value.match(/^第\s*(\d+)\s*段/)
  if (match) {
    const parsed = Number(match[1])
    if (Number.isFinite(parsed) && parsed >= 1) {
      if (parsed > paragraphCount) {
        warnings.push(`插入点「第${parsed}段之后」超出正文范围（共 ${paragraphCount} 段），已收敛到第 ${paragraphCount} 段之后`)
        return { anchor: 'after-paragraph', paragraph: paragraphCount }
      }
      return { anchor: 'after-paragraph', paragraph: parsed }
    }
  }
  warnings.push(`无法识别的插入位置「${value}」，已改为文末`)
  return { anchor: 'before-ending' }
}

/** 文件名归一：模型可能回写完整 URL、相对路径或带查询串 */
function normalizeFileName(raw: string): string {
  return raw.trim().replace(/^.*[/\\]/, '').split('?')[0].trim()
}

function parseInsertionLine(line: string, options: ParseLayoutPlanOptions, warnings: string[]): LayoutPlanInsertion | null {
  if (!/图片[：:]/.test(line)) return null
  const parts = line.split(SEPARATOR).map((part) => part.trim())
  const fileNameField = parts.find((part) => /^图片[：:]/.test(part))
  const positionField = parts.find((part) => /^(位置|插入位置)[：:]/.test(part))
  const noteField = parts.find((part) => /^说明[：:]/.test(part))
  const fileName = normalizeFileName(fileNameField?.replace(/^图片[：:]/, '') ?? '')
  if (!fileName) return null
  const asset = options.knownAssets.find((item) => item.fileName === fileName)
  if (!asset) {
    warnings.push(`方案引用的图片「${fileName}」不在可用资产中，已丢弃该插入点`)
    return null
  }
  const anchor = parseAnchor(positionField?.replace(/^(位置|插入位置)[：:]/, '') ?? '', options.paragraphCount, warnings)
  return {
    assetFileName: asset.fileName,
    ...anchor,
    note: (noteField?.replace(/^说明[：:]/, '') ?? '').trim(),
    alt: asset.alt
  }
}

export function parseLayoutPlan(raw: string, options: ParseLayoutPlanOptions): { plan: LayoutPlan; warnings: string[] } {
  const warnings: string[] = []
  const plan: LayoutPlan = { insertions: [] }
  const themeIds = new Set(options.knownThemeIds.map((theme) => theme.id))
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    // 配图插入点：段标题行（可内联首项，含「- 」列表前缀），后续列表行逐条解析
    if (/^配图插入点[：:]/.test(line)) {
      const inline = line.replace(/^配图插入点[：:]/, '').trim().replace(/^[-•*]\s*/, '')
      if (inline) {
        const insertion = parseInsertionLine(inline, options, warnings)
        if (insertion) plan.insertions.push(insertion)
      }
      continue
    }
    if (/^[-•*]\s*/.test(line)) {
      const insertion = parseInsertionLine(line.replace(/^[-•*]\s*/, ''), options, warnings)
      if (insertion) plan.insertions.push(insertion)
      continue
    }
    const theme = line.match(/^(?:推荐模板|沿用)[：:]\s*(.+)$/)
    if (theme) {
      const [themePart, ...reasonParts] = theme[1].trim().split(SEPARATOR).map((part) => part.trim())
      const themeId = themePart ?? ''
      const reason = reasonParts.join('｜').replace(/^理由[：:]/, '').trim()
      if (themeId && themeId !== '无') {
        if (themeIds.has(themeId)) {
          plan.recommendedThemeId = themeId
          plan.recommendedReason = reason || undefined
        } else {
          // 未知主题不能让界面出现无效选项；理由保留供用户参考
          plan.recommendedReason = `AI 推荐「${themeId}」（不在可用主题内）${reason ? `：${reason}` : ''}`
        }
      }
      continue
    }
    const cover = line.match(/^封面位[：:]\s*(.+)$/)
    if (cover) {
      const value = cover[1].trim()
      if (value && value !== '无') {
        const fileName = normalizeFileName(value.split(SEPARATOR)[0] ?? '')
        if (options.knownAssets.some((item) => item.fileName === fileName && item.kind === 'cover')) plan.coverAssetFileName = fileName
        else if (fileName) warnings.push(`封面位引用的图片「${fileName}」不在可用封面资产中，已忽略`)
      }
      continue
    }
    const leadIn = line.match(/^导读[：:]\s*(.+)$/)
    if (leadIn) {
      plan.leadIn = leadIn[1].trim() || undefined
      continue
    }
    const closing = line.match(/^结尾互动语[：:]\s*(.+)$/)
    if (closing) {
      plan.closing = closing[1].trim() || undefined
    }
  }
  // 同一张图只落一个位置：后出现的重复项丢弃
  const seen = new Set<string>()
  plan.insertions = plan.insertions.filter((insertion) => {
    if (seen.has(insertion.assetFileName)) return false
    seen.add(insertion.assetFileName)
    return true
  })
  return { plan, warnings }
}
