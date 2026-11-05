import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { VisualStudioService } from '../src/main/services/visual-studio-service.js'
import { BUILTIN_PROMPTS } from '../src/main/gateway/prompt-registry.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { VisualAssetService } from '../src/main/services/visual-asset-service.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'

/**
 * F1 配图回看（文本模型比对版）集成测试：
 * 真实装配 VisualStudioService + 真实 prompt 种子，验证回看结论落库与失效清理。
 */

const PROVIDER_ID = 'p1'
const MODEL_ID = 'plan-model'
const ARTICLE = '# 本地写作工具横评\n\n第一款工具的导出格式最完整，支持一键内联样式。第二款胜在排版主题丰富，但导出需要手动清理。'
const target = { providerId: PROVIDER_ID, model: MODEL_ID }

function makeGateway(): ModelGateway {
  const textOf = (content: string | Array<{ type: string; text?: string }>): string =>
    typeof content === 'string' ? content : content.map(part => part.text ?? '').join('')
  return {
    chat: vi.fn(async (request: UnifiedRequest): Promise<UnifiedResponse> => {
      const system = textOf(request.messages[0]!.content)
      const user = textOf(request.messages[1]!.content)
      const respond = (payload: unknown): UnifiedResponse => ({
        providerId: PROVIDER_ID, model: MODEL_ID, content: JSON.stringify(payload),
        extracted: undefined, extractionMatched: false, finishReason: 'stop',
        promptTokens: 5, completionTokens: 5, latencyMs: 1, jsonModeSimulated: false
      })
      if (system.includes('配图编辑')) {
        return respond({ reasoning: '给横评配一张封面和一张正文图', pictures: [
          { kind: 'cover', subject: '横评封面', purpose: '点题', blockIndex: 0, ratio: '21:9', alt: '封面', priority: 'required' },
          { kind: 'inline', subject: '导出格式对比', purpose: '呼应第一款工具段落', blockIndex: 1, ratio: '16:9', alt: '对比图', priority: 'optional' }
        ] })
      }
      if (system.includes('可直接生图')) {
        const asked = JSON.parse(user) as { pictures: Array<{ id: string }> }
        return respond({ pictures: asked.pictures.map(p => ({ id: p.id, prompt: `提示词-${p.id.slice(0, 6)}` })) })
      }
      if (system.includes('配图审稿人')) {
        const asked = JSON.parse(user) as { pictures: Array<{ id: string; placement: string }> }
        expect(asked.pictures[0]!.placement).toContain('封面')
        expect(asked.pictures[1]!.placement).toContain('第 2 段')
        expect(asked.pictures[1]!.placement).toContain('导出格式最完整')
        return respond({ pictures: asked.pictures.map((p, index) => ({ id: p.id, verdict: index === 0 ? 'match' : 'mismatch', reason: index === 0 ? '封面契合主题' : '提示词主体与段落内容无关' })) })
      }
      throw new Error(`unexpected gateway call: ${system.slice(0, 30)}`)
    })
  } as unknown as ModelGateway
}

async function setup() {
  const database = new AppDatabase(':memory:')
  database.seedPrompts(BUILTIN_PROMPTS)
  const article = database.saveArticle({
    materialIds: [], manualOutline: '大纲', status: 'locked', rawMarkdown: ARTICLE, source: 'manual'
  })
  const service = new VisualStudioService(database, makeGateway(), {} as VisualAssetService, 'unused-images-dir')
  return { database, article, service }
}

describe('配图匹配度回看（文本模型比对版）', () => {
  it('回看结论落库：封面/正文图分别得到 verdict，位置随附段落内容与失效边界', async () => {
    const { service, article } = await setup()
    const plan = await service.plan({ ...target, articleId: article.id, count: 'auto', density: 'standard', cover: true, header: false, maxInline: 4 })
    const withPrompts = await service.prompts({ ...target, planId: plan.id, expectedRevision: plan.revision })
    expect(withPrompts.pictures.every(p => p.prompt)).toBe(true)

    const reviewed = await service.review({ ...target, planId: withPrompts.id, expectedRevision: withPrompts.revision })
    const cover = reviewed.pictures.find(p => p.kind === 'cover')!
    const inline = reviewed.pictures.find(p => p.kind === 'inline')!
    expect(cover.review).toMatchObject({ verdict: 'match', reason: '封面契合主题' })
    expect(inline.review).toMatchObject({ verdict: 'mismatch', reason: '提示词主体与段落内容无关' })
  })

  it('无提示词时回看被拒绝（先出提示词再回看）', async () => {
    const { service, article } = await setup()
    const plan = await service.plan({ ...target, articleId: article.id, count: 'auto', density: 'standard', cover: true, header: false, maxInline: 4 })
    await expect(service.review({ ...target, planId: plan.id, expectedRevision: plan.revision })).rejects.toThrow('请先生成提示词')
  })

  it('提示词重新生成后旧回看结论自动失效清空', async () => {
    const { service, article } = await setup()
    const plan = await service.plan({ ...target, articleId: article.id, count: 'auto', density: 'standard', cover: true, header: false, maxInline: 4 })
    const withPrompts = await service.prompts({ ...target, planId: plan.id, expectedRevision: plan.revision })
    const reviewed = await service.review({ ...target, planId: withPrompts.id, expectedRevision: withPrompts.revision })
    expect(reviewed.pictures.every(p => p.review)).toBe(true)

    // 修改画面内容触发语义变化 → 提示词标记过期 → 重新生成 → 旧回看清空
    const edited = reviewed.pictures.map(p => ({ ...p, subject: p.subject + '（调整）' }))
    const saved = service.savePlan({ ...reviewed, pictures: edited })
    expect(saved.pictures.every(p => p.promptStale)).toBe(true)
    const regenerated = await service.prompts({ ...target, planId: saved.id, expectedRevision: saved.revision })
    expect(regenerated.pictures.every(p => p.review === undefined)).toBe(true)
  })

  it('仅调整与内容无关的字段（图注）时保留已有回看结论', async () => {
    const { service, article } = await setup()
    const plan = await service.plan({ ...target, articleId: article.id, count: 'auto', density: 'standard', cover: true, header: false, maxInline: 4 })
    const withPrompts = await service.prompts({ ...target, planId: plan.id, expectedRevision: plan.revision })
    const reviewed = await service.review({ ...target, planId: withPrompts.id, expectedRevision: withPrompts.revision })
    const edited = reviewed.pictures.map(p => ({ ...p, caption: '新图注' }))
    const saved = service.savePlan({ ...reviewed, pictures: edited })
    expect(saved.pictures.every(p => p.review)).toBe(true)
  })
})
