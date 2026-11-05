import { describe, expect, it } from 'vitest'
import { runArticleChecks } from '../src/main/services/article-checker.js'
import { polishMarkdown } from '../src/main/services/article-polisher.js'
import { validateWechatLayout } from '../src/main/services/layout-validator.js'
import { extractTopicAssessment } from '../src/main/services/topic-generator.js'

/**
 * 数据层验证基线：证明四批优化的"度量与循环"有真实的统计区分力和可接受的开销，
 * 而不是只看功能触发。全部指标可随 npm test 复跑。
 *
 * - 体检器混淆矩阵：干净样本零误报（medium/high），AI 腔样本检出率随污染强度单调上升
 * - 体检器开销：5000 字长文单次体检为微秒~毫秒级（循环内每轮都要跑，不能成为瓶颈）
 * - 排版校验器对照：合规产物零误报，8 类已知违规全部检出
 * - 选题评估解析：畸形输出全部安全降级，合法变体全部正确解析
 * - polish 循环成本：达标稿零额外调用，不达标稿最多 +2 次
 */

// ── 干净样本：人工写就的正常公众号段落（长短句交错、无套话连接词）──
const CLEAN_PARAGRAPHS = [
  '上周帮朋友排查一个老接口，日志里什么都没有，只有一行沉默的超时。真正的坑埋在半年前的一次重构里，有人把重试次数从三次改成了零，谁也没通知谁，文档还停在旧版本。修复只花了十分钟，找回信任要几个月。',
  '我妈存了半年的钱，最后还是买了一台她念叨了很久的缝纫机。她说机器比人可靠，至少不会嫌布料碎。现在她每周给楼下孩子改两次校服裤，收五块钱，图的是有人跟她说说话。',
  '第一版方案被客户否了三次，问题都出在同一处：我们把注意力放在炫技的动效上，而客户的用户群平均年龄五十二岁。后来把字号放大两号、动效全删，当天就签了。',
  '凌晨四点的批发市场里，卖豆腐的老陈已经出了第一摊。他记不清哪年 开始的，只记得儿子上小学那年冬天特别冷，从此再没睡过懒觉。',
  '把书读薄的办法其实笨得很：每读完一章，合上书给自己讲一遍，讲不下去的地方就是没读懂的地方。我用自己的话讲不出来的章节，考试时果然一道没对。',
  '这家面馆开了二十三年，招牌只有一碗阳春面。老板娘说加浇头是骗钱，汤底对了，面就是主角。来吃的出租车司机最多，一上午能翻三拨。',
  '代码评审里最值钱的意见往往只有一行：把这两个函数合并。真正难的从来不是写出来，而是忍住不写那三千行"以后可能用得上"的代码。',
  '小区门口的修鞋摊涨到十块钱了。老师傅说皮子涨价他没赚头，可他补的鞋跟，两年内没有开过胶。有人说他傻，不知道换个灯箱写"奢侈品护理"。',
  '面试过三十多个候选人之后，我判断一个人靠不靠谱只看一件事：他会不会说"这个我不确定，我查一下再答复你"。敢当场承认不知道的人，事后交来的东西反而最扎实。',
  '孩子的钢琴老师从不夸她弹得快，只问她这一句里哪个音最重要。练了半年，她终于学会在乐句的最高点松一口气——那口气比考级证书值钱。',
  '仓库角落里那台旧服务器跑了七年没重启，没人敢动它。上个月终于迁移了，前后花四十分钟，宕机时间零。所谓技术债，利息从来不是钱，是人的胆子。',
  '他学做竹椅的第十年才敢收徒弟。刨子下去一分厚薄，全在手上，说不出也写不下。现在他的椅子在网上卖八百块，评论区只有一种差评：发货太慢。'
]
const latinFiller = ' The quick brown fox keeps the balance. '

function cleanSample(index: number): string {
  const a = CLEAN_PARAGRAPHS[index % CLEAN_PARAGRAPHS.length]!
  const b = CLEAN_PARAGRAPHS[(index + 5) % CLEAN_PARAGRAPHS.length]!
  const c = CLEAN_PARAGRAPHS[(index + 9) % CLEAN_PARAGRAPHS.length]!
  return `# 样本 ${index}\n\n${a}\n\n${b}\n\n${c}${index % 2 ? latinFiller : ''}`
}

// ── AI 腔样本：在干净底稿上按强度注入污染 ──
const CLICHES = ['总而言之', '综上所述', '值得注意的是', '众所周知', '毋庸置疑', '需要注意的是']
const CONNECTIVES = ['因此', '然而', '此外', '另外', '与此同时', '不仅如此']

function taintedSample(index: number, intensity: 1 | 2 | 3): string {
  const base = cleanSample(index).split('\n').filter(Boolean).filter(line => !line.startsWith('#'))
  const sentences = base.join('').split(/(?<=。)/).map(s => s.trim()).filter(Boolean)
  // 污染 1：连接词开头（强度越高越密）；污染 2：句长拉齐（拼接定长短句）
  const padded = sentences.map((sentence, i) => {
    const prefix = i % Math.max(1, 4 - intensity) === 0 ? CONNECTIVES[(index + i) % CONNECTIVES.length] : ''
    const filler = intensity >= 2 ? `这${['一点', '一方面', '某种意义上'][i % 3]}很${['重要', '关键', '值得关注'][i % 3]}。` : ''
    return prefix + sentence + filler
  })
  // 污染 3：套话注入（强度 2 起每段收尾一个，强度 3 每段两个）+ 收进一个超长段（强度 3）
  const perParagraph = intensity === 1 ? 6 : intensity === 2 ? 8 : 16
  const paragraphs: string[] = []
  for (let i = 0; i < padded.length; i += perParagraph) {
    let chunk = padded.slice(i, i + perParagraph).join('')
    chunk += intensity >= 2 ? `总而言之，${CLICHES[(index + i) % CLICHES.length]}，这些都值得深思。` : ''
    chunk += intensity === 3 ? `综上所述，众所周知，这部分内容不容忽视。` : ''
    paragraphs.push(chunk)
  }
  const body = intensity === 3 ? paragraphs.join('') : paragraphs.join('\n\n')
  return `# AI 腔样本 ${index}（强度 ${intensity}）\n\n${body}`
}

const severity = (markdown: string): number =>
  runArticleChecks(markdown).findings.filter(f => f.severity !== 'low').length

describe('数据层验证：体检器统计特性', () => {
  const cleanSet = Array.from({ length: 30 }, (_, i) => cleanSample(i))
  const tainted = {
    light: Array.from({ length: 10 }, (_, i) => taintedSample(i, 1)),
    medium: Array.from({ length: 10 }, (_, i) => taintedSample(i + 10, 2)),
    heavy: Array.from({ length: 10 }, (_, i) => taintedSample(i + 20, 3))
  } as const

  it('干净样本零误报：30/30 的 medium/high 问题数为 0', () => {
    const flagged = cleanSet.map((sample, i) => ({ i, n: severity(sample), rules: runArticleChecks(sample).findings.filter(f => f.severity !== 'low').map(f => f.rule) }))
      .filter(item => item.n > 0)
    // 打印便于回归时定位是哪类干净文本被误伤
    if (flagged.length) console.log('误报明细:', JSON.stringify(flagged))
    expect(flagged.length).toBe(0)
  })

  it('检出率随污染强度单调上升，重度 10/10 全检出', () => {
    const rate = (samples: readonly string[]) => samples.filter(s => severity(s) > 0).length
    const light = rate(tainted.light), medium = rate(tainted.medium), heavy = rate(tainted.heavy)
    console.log(`体检器检出率：轻度 ${light}/10，中度 ${medium}/10，重度 ${heavy}/10`)
    expect(heavy).toBe(10)
    expect(medium).toBeGreaterThanOrEqual(light)
    expect(light + medium + heavy).toBeGreaterThanOrEqual(15)
  })

  it('问题数随强度递增（中度均值高于轻度，重度高于中度）', () => {
    const avg = (samples: readonly string[]) => samples.reduce((sum, s) => sum + severity(s), 0) / samples.length
    const light = avg(tainted.light), medium = avg(tainted.medium), heavy = avg(tainted.heavy)
    console.log(`平均问题数：轻度 ${light.toFixed(1)}，中度 ${medium.toFixed(1)}，重度 ${heavy.toFixed(1)}`)
    expect(medium).toBeGreaterThan(light)
    expect(heavy).toBeGreaterThan(medium)
  })

  it('开销基准：5000 字长文单次体检 < 25ms（循环每轮都要跑，不能成为瓶颈）', () => {
    const long = taintedSample(0, 3).repeat(15)
    expect(long.length).toBeGreaterThan(5000)
    const times: number[] = []
    for (let i = 0; i < 20; i += 1) {
      const started = performance.now()
      runArticleChecks(long)
      times.push(performance.now() - started)
    }
    times.sort((a, b) => a - b)
    const p50 = times[10]!, p95 = times[18]!
    console.log(`体检器耗时（${Math.round(long.length / 1000)}k 字符）：p50=${p50.toFixed(2)}ms，p95=${p95.toFixed(2)}ms`)
    expect(p95).toBeLessThan(25)
  })
})

describe('数据层验证：polish 循环成本模型', () => {
  it('达标稿零额外调用；不达标稿 1 轮修正后达标，总成本 = 生成 1 + 改写 1', async () => {
    let reviseCalls = 0
    const untouched = await polishMarkdown(cleanSample(0), { callRevise: async () => { reviseCalls += 1; return cleanSample(1) } })
    expect(reviseCalls).toBe(0)
    expect(untouched.summary).toBe('')

    const fixed = await polishMarkdown(taintedSample(0, 3), { callRevise: async () => { reviseCalls += 1; return cleanSample(2) } })
    expect(reviseCalls).toBe(1)
    expect(severity(fixed.markdown)).toBe(0)
    expect(fixed.summary).toContain('已达标')
  })
})

describe('数据层验证：排版校验器检出对照', () => {
  const compliant = '<section style="font-size:15px;line-height:1.8"><p style="margin:0 0 16px"><span leaf="">这是合规正文，字号行高都符合平台规范。</span></p><img src="https://mmbiz.qpic.cn/mmbiz_png/x.png" style="max-width:100%;height:auto"></section>'

  it('合规排版零误报', () => {
    const violations = validateWechatLayout({ html: compliant, title: '合规标题', digest: 'd' })
    expect(violations.filter(v => v.level === 'error')).toEqual([])
  })

  const cases: Array<[string, string, string]> = [
    ['禁用标签 div', '<div style="padding:0">x</div>', 'forbidden-tag:div'],
    ['残留 style 标签', '<style>p{}</style><p><span leaf="">x</span></p>', 'forbidden-tag:style'],
    ['CSS 变量', '<p style="color:var(--brand)">x</p>', 'forbidden-css:CSS 变量 var(--…)'],
    ['!important', '<p style="color:red !important">x</p>', 'forbidden-css:important'],
    ['leaf 包块级', '<span leaf=""><p style="margin:0">块级被包进 leaf</p></span>', 'leaf-block-child'],
    ['外链图', '<img src="https://cdn.example.com/a.png">', 'image-not-wechat-cdn'],
    ['标题超长', `<section>${'标'.repeat(33)}</section>`, 'title-too-long']
  ]
  it.each(cases)('检出：%s', (_name, html, rule) => {
    const violations = validateWechatLayout({ html, title: '标'.repeat(33).length > 32 && rule === 'title-too-long' ? '标'.repeat(33) : 'T' })
    expect(violations.some(v => v.rule === rule)).toBe(true)
  })

  it('检出率 8/8（含页内锚点与冗余嵌套）', () => {
    const nested = `<section style="margin:0">${'<section style="margin:0">'.repeat(12)}x${'</section>'.repeat(12)}</section>`
    const html = `${nested}<a href="#top">回目录</a>`
    const violations = validateWechatLayout({ html, title: 'T' })
    const rules = new Set(violations.map(v => v.rule))
    expect(rules.has('anchor-link-dead')).toBe(true)
    expect(rules.has('redundant-nesting')).toBe(true)
  })
})

describe('数据层验证：选题评估解析健壮性', () => {
  const fields = JSON.stringify({ 选题主题: 't', 切入角度: 'a', 目标读者: 'r', 核心观点: 'v', 情绪基调: 'm', 拟标题方向: 'h', 备注: '' })
  it('合法变体 8/8 解析成功（含围栏/字符串数字/小数夹紧/数组包裹/多余键）', () => {
    const variants = [
      JSON.stringify({ ...JSON.parse(fields), 评估: { 吸引力: 8, 差异化: 9, 可行性: 7, 理由: 'x' } }),
      '```json\n' + JSON.stringify({ ...JSON.parse(fields), 评估: { 吸引力: '8', 差异化: '9', 可行性: '7', 理由: 'x' } }) + '\n```',
      JSON.stringify({ ...JSON.parse(fields), 评估: { 吸引力: 8.4, 差异化: 99, 可行性: 0, 理由: 'x' } }),
      JSON.stringify([JSON.parse(fields)]).replace('}]', ', 评估: {"吸引力":5,"差异化":5,"可行性":5,"理由":"x"}}]').replace(', 评估:', ',"评估":'),
      JSON.stringify({ ...JSON.parse(fields), 评估: { 吸引力: 8, 差异化: 9, 可行性: 7 } }),
      JSON.stringify({ ...JSON.parse(fields), 多余键: '忽略', 评估: { 吸引力: 8, 差异化: 9, 可行性: 7, 理由: 'x' } }),
      JSON.stringify({ ...JSON.parse(fields), 评估: { 吸引力: ' 7 ', 差异化: 9, 可行性: 7, 理由: '  ' } }),
      '前言' + JSON.stringify({ ...JSON.parse(fields), 评估: { 吸引力: 8, 差异化: 9, 可行性: 7, 理由: 'x' } }) + '后记'
    ]
    const parsed = variants.map(v => extractTopicAssessment(v))
    expect(parsed.filter(Boolean)).toHaveLength(8)
    // 夹紧与字符串数字
    expect(parsed[2]).toEqual({ appeal: 8, differentiation: 10, feasibility: 1, reason: 'x' })
    expect(parsed[6]!.reason).toBe('')
  })

  it('畸形输出 6/6 安全降级（undefined，绝不阻断选题生成）', () => {
    expect(extractTopicAssessment(fields)).toBeUndefined()
    expect(extractTopicAssessment('模型输出了解释性文字，没有 JSON')).toBeUndefined()
    expect(extractTopicAssessment(JSON.stringify({ ...JSON.parse(fields), 评估: { 吸引力: 8 } }))).toBeUndefined()
    expect(extractTopicAssessment(JSON.stringify({ ...JSON.parse(fields), 评估: '高' }))).toBeUndefined()
    expect(extractTopicAssessment(JSON.stringify({ ...JSON.parse(fields), 评估: { 吸引力: NaN, 差异化: 1, 可行性: 1, 理由: '' } }))).toBeUndefined()
    expect(extractTopicAssessment('{"吸引力": 8, "差异化": "9",')).toBeUndefined()
  })
})
