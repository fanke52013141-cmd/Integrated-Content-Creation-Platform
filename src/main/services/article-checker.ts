/**
 * 确定性文风体检器："能代码算的不进模型"。
 *
 * 与评审角色的分工：模型评审判断观点、事实与论证质量；本模块只算机械指标——
 * 套话命中、连接词密度、句长均匀度（AI 腔的稳定信号）、段落节奏、同构开头。
 * 零模型成本、结果可复现、永不失败；意见直接进入评审任务，与模型意见同样
 * 可被采纳并进入改稿，为后续"评分不过自动改稿"的循环提供确定性基线。
 */

export interface ArticleCheckMetric {
  key: string
  label: string
  value: number
  hint?: string
}

export interface ArticleCheckFinding {
  rule: string
  severity: 'high' | 'medium' | 'low'
  position: string
  issue: string
  suggestion: string
  /** 原文逐字片段，供改稿定位；保证能在原稿中检索到 */
  anchor?: string
}

export interface ArticleCheckReport {
  wordCount: number
  metrics: ArticleCheckMetric[]
  findings: ArticleCheckFinding[]
  overall: string
  /** 无 high 即通过；作为后续自动迭代循环的闸门 */
  passed: boolean
}

/** 高信号套话：命中即明显暴露模板腔 */
const CLICHE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: '总而言之', pattern: /总而言之/g },
  { label: '综上所述', pattern: /综上所述/g },
  { label: '总的来说', pattern: /总的来说/g },
  { label: '值得注意的是', pattern: /值得注意的是/g },
  { label: '需要注意的是', pattern: /需要注意的是/g },
  { label: '毋庸置疑', pattern: /毋庸置疑/g },
  { label: '众所周知', pattern: /众所周知/g },
  { label: '"在这个…的时代"式开头', pattern: /在这个[^。！？!?\n]{0,14}的时代/g },
  { label: '赋能', pattern: /赋能/g },
  { label: '抓手', pattern: /抓手/g },
  { label: '底层逻辑', pattern: /底层逻辑/g }
]

/** 模板化连接词：少量正常，密度过高即 AI 腔 */
const CONNECTIVES = ['首先', '其次', '此外', '另外', '与此同时', '不仅如此', '更重要的是', '换句话说', '因此', '然而', '事实上', '总之', '其实']

const CLICHE_DENSITY_MEDIUM = 6 // 每千字
const CLICHE_DENSITY_HIGH = 12
const CONNECTIVE_DENSITY_MEDIUM = 10 // 每千字
const CONNECTIVE_DENSITY_HIGH = 16
const SENTENCE_CV_THRESHOLD = 0.3 // 句长变异系数低于该值视为过于均匀
const MIN_SENTENCES_FOR_CV = 8
const LONG_PARAGRAPH_CHARS = 350
const REPEATED_OPENING_RUN = 3
const MIN_WORD_COUNT = 300

export function runArticleChecks(markdown: string): ArticleCheckReport {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
  const wordCount = countWords(withoutCode)
  const findings: ArticleCheckFinding[] = []
  const metrics: ArticleCheckMetric[] = [ { key: 'word-count', label: '字数', value: wordCount } ]

  if (wordCount >= MIN_WORD_COUNT) {
    // ── 套话 ──
    const clicheHits = CLICHE_PATTERNS.map(({ label, pattern }) => ({
      label,
      count: [...withoutCode.matchAll(pattern)].length
    })).filter((hit) => hit.count > 0)
    const clicheTotal = clicheHits.reduce((sum, hit) => sum + hit.count, 0)
    const clicheDensity = density(clicheTotal, wordCount)
    metrics.push({ key: 'cliche-density', label: '套话密度', value: clicheDensity, hint: '处/千字' })
    if (clicheHits.length) {
      const samples = clicheHits.slice().sort((a, b) => b.count - a.count).slice(0, 5)
        .map((hit) => `${hit.label}×${hit.count}`).join('、')
      const firstAnchor = findAnchor(withoutCode, clicheHits[0]!.label)
      if (clicheDensity >= CLICHE_DENSITY_HIGH) {
        findings.push({
          rule: 'cliche-phrases', severity: 'high', position: '全文',
          issue: `套话密度 ${clicheDensity} 处/千字，模板腔明显：${samples}`,
          suggestion: '删除或改写这些套话，直接陈述具体事实与判断',
          anchor: firstAnchor
        })
      } else if (clicheDensity >= CLICHE_DENSITY_MEDIUM) {
        findings.push({
          rule: 'cliche-phrases', severity: 'medium', position: '全文',
          issue: `套话密度偏高（${clicheDensity} 处/千字）：${samples}`,
          suggestion: '优先改写高频套话，用具体表达替代',
          anchor: firstAnchor
        })
      } else {
        findings.push({
          rule: 'cliche-phrases', severity: 'low', position: '全文',
          issue: `出现套话：${samples}`,
          suggestion: '可保留少量，但开头与收尾处避免使用',
          anchor: firstAnchor
        })
      }
    }

    // ── 连接词密度 ──
    const connectiveTotal = CONNECTIVES.reduce((sum, word) => sum + countOccurrences(withoutCode, word), 0)
    const connectiveDensity = density(connectiveTotal, wordCount)
    metrics.push({ key: 'connective-density', label: '连接词密度', value: connectiveDensity, hint: '处/千字' })
    if (connectiveDensity >= CONNECTIVE_DENSITY_HIGH) {
      findings.push({
        rule: 'connective-density', severity: 'high', position: '全文',
        issue: `连接词密度 ${connectiveDensity} 处/千字，段落推进依赖"首先/然而/因此"式模板`,
        suggestion: '删掉大部分连接词，靠内容自身的逻辑推进段落'
      })
    } else if (connectiveDensity >= CONNECTIVE_DENSITY_MEDIUM) {
      findings.push({
        rule: 'connective-density', severity: 'medium', position: '全文',
        issue: `连接词密度偏高（${connectiveDensity} 处/千字）`,
        suggestion: '保留必要的转折与因果，其余连接关系让句子顺序自然承担'
      })
    }
  } else {
    findings.push({
      rule: 'thin-content', severity: 'low', position: '全文',
      issue: `正文仅约 ${wordCount} 字，信息量偏少`,
      suggestion: '补充具体案例、数据或操作细节'
    })
  }

  // ── 段落节奏与句式（代码块不参与）──
  const blocks = withoutCode.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  const proseBlocks = blocks.filter((block) => isProseBlock(block))
  let longParagraphCount = 0
  proseBlocks.forEach((block, index) => {
    if (block.length > LONG_PARAGRAPH_CHARS) {
      longParagraphCount += 1
      findings.push({
        rule: 'long-paragraph', severity: 'medium', position: `第 ${index + 1} 段`,
        issue: `单段约 ${block.length} 字，手机端阅读吃力`,
        suggestion: '在语义转折处拆段，或把并列内容改成列表',
        anchor: block.slice(0, 30)
      })
    }
  })
  metrics.push({ key: 'long-paragraphs', label: '超长段落', value: longParagraphCount, hint: `> ${LONG_PARAGRAPH_CHARS} 字` })

  const sentences = proseBlocks.flatMap((block) => splitSentences(block))
  const lengths = sentences.map((sentence) => countWords(sentence)).filter((length) => length >= 2)
  if (lengths.length >= MIN_SENTENCES_FOR_CV) {
    const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length
    const variance = lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / lengths.length
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0
    metrics.push({ key: 'sentence-cv', label: '句长变异系数', value: round2(cv), hint: '低于 0.3 视为过于均匀' })
    if (cv < SENTENCE_CV_THRESHOLD) {
      findings.push({
        rule: 'sentence-uniformity', severity: 'medium', position: '全文',
        issue: `句长过于均匀（变异系数 ${round2(cv)}），是典型的机器生成节奏`,
        suggestion: '长短句交错：把几层意思合并成一个长句，再用短句收住'
      })
    }
  }

  proseBlocks.forEach((block, index) => {
    const opening = findRepeatedOpening(block)
    if (opening) {
      findings.push({
        rule: 'repeated-openings', severity: 'medium', position: `第 ${index + 1} 段`,
        issue: `连续 ${REPEATED_OPENING_RUN} 句以"${opening.key}"开头，句式同构`,
        suggestion: '变换句子主语或结构，打破排比式推进',
        anchor: block.slice(0, 30)
      })
    }
  })

  const severityRank = { high: 0, medium: 1, low: 2 } as const
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
  const highs = findings.filter((finding) => finding.severity === 'high').length
  const mediums = findings.filter((finding) => finding.severity === 'medium').length
  let overall: string
  if (!wordCount) overall = '正文为空，无法体检'
  else if (highs) overall = `体检发现 ${highs} 处明显 AI 腔信号，建议优先修正`
  else if (mediums) overall = `发现 ${mediums} 处文风问题，建议采纳修正后再发布`
  else overall = '机械指标未见明显 AI 腔信号'
  return { wordCount, metrics, findings, overall, passed: highs === 0 }
}

function density(hits: number, wordCount: number): number {
  return wordCount > 0 ? round2((hits / wordCount) * 1000) : 0
}

function countOccurrences(text: string, word: string): number {
  return text.split(word).length - 1
}

function countWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z]+/g)?.length ?? 0
  return cjk + latin
}

function findAnchor(text: string, phrase: string): string | undefined {
  const index = text.indexOf(phrase.replace(/…/g, ''))
  if (index >= 0) return text.slice(index, index + Math.min(30, phrase.length + 10))
  return undefined
}

/** 标题、列表、引用、表格不算正文段 */
function isProseBlock(block: string): boolean {
  return !block.split('\n').every((line) => {
    const trimmed = line.trim()
    return !trimmed || /^[#>*|]|^\d+[.、)]/.test(trimmed)
  })
}

function splitSentences(block: string): string[] {
  return block
    .split(/[。！？!?]+/)
    .map((sentence) => sentence.replace(/^[\s、"''（）()【】\[\]]+/, '').trim())
    .filter((sentence) => sentence.length >= 2)
}

/** 连续 N 句以相同二字开头（如"我们…我们…我们…"）视为同构推进 */
function findRepeatedOpening(block: string): { key: string } | null {
  const sentences = splitSentences(block)
  let runKey = ''
  let runLength = 0
  for (const sentence of sentences) {
    const key = /^[一-龥a-zA-Z]{2}$/.test(sentence.slice(0, 2)) ? sentence.slice(0, 2) : ''
    if (key && key === runKey) {
      runLength += 1
      if (runLength >= REPEATED_OPENING_RUN) return { key }
    } else {
      runKey = key
      runLength = 1
    }
  }
  return null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
