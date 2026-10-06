import { createHash } from 'node:crypto'
import { escapeXml } from '../../shared/domain.js'
import type { Material, MaterialContext, MaterialFragment } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'

/** 保守按一字符一 token 估算；不把整份长文档塞进模型。原文始终完整保留。 */
export function buildMaterialContext(database: AppDatabase, materials: Material[], query: string, budget = 16_000): MaterialContext {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [])]
    .flatMap(term => /[\u4e00-\u9fff]/.test(term) && term.length > 4 ? Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2)) : [term]).slice(0, 100)
  const fragments: Array<MaterialFragment & { score: number; order: number }> = []
  let totalChars = 0
  materials.forEach((material, order) => {
    const document = database.workflow.getDocument(material.id)
    const text = document?.content ?? material.summary
    const versionId = document?.versionId ?? createHash('sha256').update(text).digest('hex')
    totalChars += text.length
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + 1000)
      const boundary = text.lastIndexOf('\n', end)
      if (boundary > start + 500) end = boundary
      const fragment = text.slice(start, end)
      const lower = fragment.toLowerCase()
      fragments.push({ id: `${material.id}:${start}-${end}`, materialId: material.id, versionId, title: material.title,
        sourceUrl: material.sourceUrl, start, end, text: fragment,
        score: terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0), order })
      if (end === text.length) break
      start = end
    }
  })
  // 每份素材优先一个最相关片段，之后按相关度补充；没有关键词时按原文顺序。
  const ranked = [...fragments].sort((a, b) => b.score - a.score || a.order - b.order || a.start - b.start)
  const first = materials.flatMap(material => ranked.find(item => item.materialId === material.id) ?? [])
  const seen = new Set<string>()
  const selected: MaterialFragment[] = []
  let used = 0
  for (const item of [...first, ...ranked]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const { score: _score, order: _order, ...fragment } = item
    const cost = serializeFragment(fragment).length
    if (used + cost > Math.max(0, budget)) continue
    used += cost
    selected.push(fragment)
  }
  selected.sort((a, b) => materials.findIndex(item => item.id === a.materialId) - materials.findIndex(item => item.id === b.materialId) || a.start - b.start)
  const usedChars = selected.reduce((sum, item) => sum + item.text.length, 0)
  return { fragments: selected, totalChars, usedChars, omittedChars: totalChars - usedChars,
    text: selected.length ? `<素材依据>\n${selected.map(serializeFragment).join('\n')}\n</素材依据>` : '<素材依据>未提供可用片段；不可虚构事实、数字或来源。</素材依据>' }
}

function serializeFragment(fragment: MaterialFragment): string {
  return `<片段 ID="${escapeXml(fragment.id)}" 版本="${fragment.versionId}" 位置="${fragment.start}-${fragment.end}">\n标题：${escapeXml(fragment.title)}\n来源：${escapeXml(fragment.sourceUrl ?? '本地素材，未提供外链')}\n${escapeXml(fragment.text)}\n</片段>`
}

export function contextBudget(database: AppDatabase, providerId: string, model: string, baseText: string, output = 8000): number {
  const limits = database.listProviderModels(providerId).find(item => item.modelId === model)
  const capacity = limits?.contextLimit ?? 32_768
  const reservedOutput = Math.min(output, limits?.outputLimit ?? output)
  const budget = capacity - reservedOutput - baseText.length - 1500
  if (budget < 1000) throw new Error('账号定位、原稿或框架超过模型上下文预算，请精简内容或选择更大上下文模型')
  return budget
}

export function modelOutputTokens(database: AppDatabase, providerId: string, model: string, requested: number): number {
  return Math.max(1, Math.min(requested, database.listProviderModels(providerId).find(item => item.modelId === model)?.outputLimit ?? requested))
}
