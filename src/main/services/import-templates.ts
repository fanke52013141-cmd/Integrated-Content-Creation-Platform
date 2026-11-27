import type { ContentImportKind } from '../../shared/contracts.js'

export interface ImportTemplateDefinition {
  fileName: string
  content: string
  mediaType: string
  note: string
}

function csv(rows: Array<Array<string | number>>): string {
  return `﻿${rows.map((row) => row.map((value) => {
    const text = String(value ?? '')
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }).join(',')).join('\r\n')}\r\n`
}

const FIELD_VALUE_TEMPLATE = (rows: Array<[string, string]>): string => csv([
  ['字段名称', '字段内容'],
  ...rows
])

/**
 * 可直接用 Excel / WPS 打开的标准导入模板。
 * 示例行是为了让字段结构可见，不要求用户保留示例内容。
 */
export function importTemplateDefinition(kind: ContentImportKind): ImportTemplateDefinition {
  if (kind === 'account') {
    return {
      fileName: '账号设定-标准导入表.csv',
      mediaType: 'text/csv;charset=utf-8',
      note: '字段名称请保留；字段内容可替换为自己的账号定位。',
      content: FIELD_VALUE_TEMPLATE([
        ['账号名称', 'AI 资讯观察'],
        ['简介', '用克制、可核查的方式解读 AI 与内容行业变化'],
        ['领域', '科技资讯与内容创作'],
        ['目标受众', '关注 AI 工具、效率提升的职场人'],
        ['写作风格', '理性克制，先事实后观点，注明来源'],
        ['IP人设', '冷静可靠的行业观察者'],
        ['差异化定位', '不追概念，聚焦真实工作流和案例'],
        ['价值主张', '帮助读者判断 AI 工具是否值得使用']
      ])
    }
  }
  if (kind === 'hot-item') {
    return {
      fileName: '热点-标准导入表.csv',
      mediaType: 'text/csv;charset=utf-8',
      note: '一行一条热点；没有链接也可作为灵感记录。',
      content: csv([
        ['标题', '链接', '来源', '热度', '摘要', '发布时间'],
        ['AI 工具进入内容团队工作流', 'https://example.com/hotspot', '示例媒体', '9800', '关注真实落地流程，不只看模型参数', '2026-11-27T09:00:00+08:00']
      ])
    }
  }
  if (kind === 'topic') {
    return {
      fileName: '话题-标准导入表.csv',
      mediaType: 'text/csv;charset=utf-8',
      note: '一行一个话题，表头可映射到选题字段。',
      content: csv([
        ['选题主题', '切入角度', '目标读者', '核心观点', '情绪基调', '拟标题方向', '备注'],
        ['AI Agent 真正落地前要跨过的三道坎', '从失败试点反推落地条件', '正在引入 AI 的团队负责人', 'Agent 落地是流程改造，不是工具采购', '冷静、具体', '别急着买工具：先看这三道坎', '示例行，可替换']
      ])
    }
  }
  if (kind === 'framework') {
    return {
      fileName: '写作框架-标准导入表.csv',
      mediaType: 'text/csv;charset=utf-8',
      note: '同一个框架主题可以有多行，每行对应一个章节；章节顺序按表格顺序保留。',
      content: csv([
        ['框架主题', '章节名称', '章节内容'],
        ['AI Agent 落地前的三道坎', '开头', '从一个失败试点切入，说明问题不是模型不够强。'],
        ['AI Agent 落地前的三道坎', '流程边界', '先梳理输入、责任人和异常分支。'],
        ['AI Agent 落地前的三道坎', '数据与权限', '明确数据读取、操作权限、审计与回滚方式。'],
        ['AI Agent 落地前的三道坎', '人工复核', '高风险动作必须有人工接管节点。'],
        ['AI Agent 落地前的三道坎', '结尾', '给出可执行的小范围试点清单。']
      ])
    }
  }
  if (kind === 'article') {
    return {
      fileName: '文章-标准导入表.csv',
      mediaType: 'text/csv;charset=utf-8',
      note: '一行一篇文章；正文支持 Markdown、换行、标题、列表与加粗。也可直接导入 DOCX / HTML / Markdown。',
      content: csv([
        ['标题', '正文'],
        ['AI Agent 落地前的三道坎', '# AI Agent 落地前的三道坎\n\n很多团队把失败归因于模型，但真正的问题往往出在流程。\n\n## 先梳理流程\n\n明确输入、责任人和异常分支，再决定哪些步骤适合自动化。\n\n- 数据读取权限\n- 高风险动作复核\n- 失败后的回滚方式']
      ])
    }
  }
  if (kind === 'review') {
    return {
      fileName: '评审-标准导入表.csv',
      mediaType: 'text/csv;charset=utf-8',
      note: '一行一条评审问题，严重度可填 高 / 中 / 低。',
      content: csv([
        ['位置', '严重度', '问题', '建议'],
        ['第二段', '高', '案例缺少原始出处，无法核验其真实性', '补充来源链接或改为一般性表达'],
        ['结尾', '低', '行动建议不够具体，读者不知道下一步怎么做', '列出可执行的第一步和检查方式']
      ])
    }
  }
  if (kind === 'visual-plan') {
    return {
      fileName: '图片-标准导入表.csv',
      mediaType: 'text/csv;charset=utf-8',
      note: '图片类型可填 封面 / 文内图 / 发布图；图片路径填表格同目录下的相对路径，或 http(s) 图片地址。',
      content: csv([
        ['图片类型', '图片路径或网址', '位置', '用途', '比例', '提示词', '替代文本', '封面文案'],
        ['封面', 'images/cover.png', '', '公众号封面', '21:9', '暖色书桌与清晰流程图，无文字水印', '封面示意图', '把复杂问题讲清楚'],
        ['文内图', 'images/inline-1.png', '先梳理流程', '解释流程边界', '16:9', '简洁流程图插画，无文字水印', '流程边界示意图', ''],
        ['发布图', 'https://example.com/release.png', '公众号头图', '发布分享', '21:9', '同封面视觉风格', '发布配图', '']
      ])
    }
  }
  if (kind === 'layout') {
    return {
      fileName: '排版稿-标准导入模板.html',
      mediaType: 'text/html;charset=utf-8',
      note: '可保留 section、p、h2、列表、表格与内联样式；脚本、事件属性和外链样式会被移除。',
      content: '<section><h1 style="font-size:24px;color:#111827;line-height:1.5">外部排版稿标题</h1><h2 style="font-size:20px;color:#b45309;margin-top:28px">章节标题</h2><p style="font-size:16px;line-height:1.9;color:#374151">正文内容，可直接粘贴到公众号编辑器。</p></section>'
    }
  }
  if (kind === 'publish-form') {
    return {
      fileName: '发布信息-标准导入表.csv',
      mediaType: 'text/csv;charset=utf-8',
      note: '作者、摘要、原文链接和封面素材 ID 可单独导入，AppID 与 AppSecret 请在发布管理中配置。',
      content: FIELD_VALUE_TEMPLATE([
        ['author', '作者名称'],
        ['digest', '一句话摘要，说明文章解决的问题'],
        ['contentSourceUrl', 'https://example.com/original'],
        ['thumbMediaId', '（可选）公众号封面素材 ID'],
        ['appId', '（可选）不填则使用发布管理中的默认公众号']
      ])
    }
  }
  return {
    fileName: '提示词-标准导入模板.json',
    mediaType: 'application/json;charset=utf-8',
    note: '提示词 key 必须已存在；modelBinding 可选，不包含 API Key。',
    content: JSON.stringify({ prompts: [{ key: 'topic.generate', title: '选题生成', content: '根据已核验来源生成具体、可执行的选题，保留 JSON 输出要求。', note: '外部导入', modelBinding: null }] }, null, 2)
  }
}
