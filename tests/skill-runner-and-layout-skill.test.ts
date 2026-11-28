import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database.js'
import { PromptRegistry } from '../src/main/gateway/prompt-registry.js'
import type { ModelGateway } from '../src/main/gateway/model-gateway.js'
import type { UnifiedRequest, UnifiedResponse } from '../src/main/gateway/types.js'
import { runControlledSkillLoop } from '../src/main/services/skill-runner.js'
import { FrameworkGenerator } from '../src/main/services/framework-generator.js'
import { LayoutPlanService } from '../src/main/services/layout-plan-service.js'
import { polishMarkdown } from '../src/main/services/article-polisher.js'

function setupProvider(db: AppDatabase): void {
  db.saveProvider({
    id: 'p1',
    displayName: '测试供应商',
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1',
    defaultModel: 'm1',
    enabled: true,
    isRelay: false,
    capabilities: { chat: true, jsonMode: true, streaming: false, vision: false, image: false },
    models: [{ modelId: 'm1', displayName: 'm1', reasoningVariants: [], isDefault: true, enabled: true }]
  })
}

describe('Batch C: controlled multi-turn Skill runner & three heavy-stage Skills', () => {
  it('runControlledSkillLoop refines until zero issues and rolls back on regression', async () => {
    const ok = await runControlledSkillLoop({
      initial: { score: 2 },
      maxRounds: 2,
      evaluate: async (current) => ({
        issueCount: current.score,
        feedback: `还有 ${current.score} 个问题`,
        summary: `当前 ${current.score} 个问题`
      }),
      refine: async (current) => ({ score: Math.max(0, current.score - 1) })
    })
    expect(ok.value.score).toBe(0)
    expect(ok.improvedRounds).toBe(2)

    const regressed = await runControlledSkillLoop({
      initial: { score: 1, tag: 'v1' },
      maxRounds: 2,
      evaluate: async (current) => ({
        issueCount: current.score,
        feedback: '修正',
        summary: `问题 ${current.score}`
      }),
      refine: async () => ({ score: 3, tag: 'worse' })
    })
    expect(regressed.value.tag).toBe('v1')
    expect(regressed.improvedRounds).toBe(0)
  })

  it('FrameworkGenerator useSkill runs critique and refines framework with trace', async () => {
    const db = new AppDatabase(':memory:')
    try {
      setupProvider(db)
      const prompts = new PromptRegistry(db)
      prompts.seed()
      const template = db.listFrameworkTemplates()[0]!

      let call = 0
      const gateway = {
        chat: async (request: UnifiedRequest): Promise<UnifiedResponse> => {
          call += 1
          let content = ''
          if (call === 1) {
            content = '<框架><标题>初版标题</标题><开头>初版开头</开头><论点一>初版一</论点一><论点二>初版二</论点二><论点三>初版三</论点三><结尾>初版结尾</结尾></框架>'
          } else if (call === 2) {
            content = '- 论点一过于空泛，缺少具体场景对比\n- 结尾未回应读者实操疑虑'
          } else {
            content = '<框架><标题>重构后标题</标题><开头>具体场景切入</开头><论点一>强化论点一</论点一><论点二>强化论点二</论点二><论点三>强化论点三</论点三><结尾>可落地步骤</结尾></框架>'
          }
          return {
            content, providerId: request.providerId, model: request.model ?? 'm1',
            latencyMs: 10, finishReason: 'stop', extractionMatched: false, jsonModeSimulated: false
          }
        }
      } as unknown as ModelGateway

      const generator = new FrameworkGenerator(db, gateway, prompts)
      const result = await generator.generate({
        templateId: template.id,
        manualTopic: '人机协作写公众号如何提效',
        materialIds: [],
        providerId: 'p1',
        model: 'm1',
        count: 1,
        research: false,
        useSkill: true
      })

      expect(result.frameworks).toHaveLength(1)
      expect(result.frameworks[0]!.sections[0]!.content).toBe('重构后标题')
      expect(result.skillTrace?.some((step) => step.improved === true)).toBe(true)
    } finally {
      db.close()
    }
  })

  it('LayoutPlanService useSkill detects anchor/asset warnings and auto-fixes in round 2', async () => {
    const db = new AppDatabase(':memory:')
    try {
      setupProvider(db)
      const prompts = new PromptRegistry(db)
      prompts.seed()
      const article = db.saveArticle({
        materialIds: [],
        manualOutline: '',
        status: 'draft',
        source: 'manual',
        rawMarkdown: '# 排版测试文章\n\n第一段正文。\n\n第二段正文。'
      })

      let call = 0
      const gateway = {
        chat: async (request: UnifiedRequest): Promise<UnifiedResponse> => {
          call += 1
          const body = call === 1
            ? '配图插入点：\n- 图片：missing.png ｜ 位置：第99段之后 ｜ 说明：不存在的图片\n推荐模板：editorial ｜ 理由：稳重\n封面位：无\n导读：一句导读\n结尾互动语：欢迎留言'
            : '配图插入点：无\n推荐模板：editorial ｜ 理由：稳重\n封面位：无\n导读：一句更稳的导读\n结尾互动语：欢迎留言'
          return {
            content: `<排版方案>\n${body}\n</排版方案>`,
            extracted: body,
            extractionMatched: true,
            providerId: request.providerId,
            model: request.model ?? 'm1',
            latencyMs: 10,
            finishReason: 'stop',
            jsonModeSimulated: false
          }
        }
      } as unknown as ModelGateway

      const service = new LayoutPlanService(db, gateway, prompts)
      const result = await service.generate({
        articleId: article.id,
        providerId: 'p1',
        model: 'm1',
        useSkill: true
      })

      expect(call).toBe(2)
      expect(result.warnings).toHaveLength(0)
      expect(result.plan.leadIn).toBe('一句更稳的导读')
      expect(result.skillTrace?.some((step) => step.improved === true)).toBe(true)
    } finally {
      db.close()
    }
  })

  it('polishMarkdown detects ungrounded numeric percentage claims against evidence fragments', async () => {
    const seenInstructions: string[] = []
    const outcome = await polishMarkdown(
      '# 标题\n\n测试表明这套流程把团队效率提升了 98.7%，效果非常显著。',
      {
        evidenceFragments: [{ text: '团队反馈这套流程减少了大量重复复制粘贴。' }],
        callRevise: async (_md, instruction) => {
          seenInstructions.push(instruction)
          return '# 标题\n\n测试表明这套流程显著减少了重复复制粘贴，团队整体效率有明显改善。'
        }
      }
    )

    expect(seenInstructions[0]).toContain('98.7%')
    expect(outcome.rounds).toHaveLength(1)
    expect(outcome.rounds[0]!.improved).toBe(true)
    expect(outcome.markdown).not.toContain('98.7%')
  })
})
