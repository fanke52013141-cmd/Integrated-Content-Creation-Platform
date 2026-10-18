import type { ProviderPreset } from '../../shared/contracts.js'

const commonCapabilities = {
  chat: true,
  jsonMode: true,
  streaming: false,
  vision: false,
  image: false
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
    capabilities: commonCapabilities
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    capabilities: commonCapabilities
  },
  {
    id: 'moonshot',
    displayName: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    capabilities: commonCapabilities
  },
  {
    id: 'zhipu',
    displayName: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    capabilities: commonCapabilities
  },
  {
    id: 'doubao',
    displayName: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2-1-turbo-260628',
    capabilities: commonCapabilities,
    // 该系列默认开启思考，单句回答也要上千 token、首字十几秒；创作类请求默认关闭
    modelParams: { thinking: { type: 'disabled' } }
  },
  {
    // 生图专用供应商：只勾图片生成，避免把生图模型拿去跑对话
    id: 'toapis',
    displayName: 'ToAPIs 生图',
    baseUrl: 'https://api.toapis.com/v1',
    defaultModel: 'gpt-image-2-vip',
    capabilities: { chat: false, jsonMode: false, streaming: false, vision: false, image: true }
  },
  {
    // VIP 版：按 token 结算，支持六档质量；同一把 key 即可
    id: 'toapis-vip',
    displayName: 'ToAPIs 生图（VIP）',
    baseUrl: 'https://api.toapis.com/v1',
    defaultModel: 'gpt-image-2.5-flare-vip',
    capabilities: { chat: false, jsonMode: false, streaming: false, vision: false, image: true }
  },
  {
    id: 'wechat-ai',
    displayName: '微信云开发 AI',
    baseUrl: 'https://chatapi.weixin.qq.com/openai/v1',
    defaultModel: 'GLM-5.2',
    capabilities: commonCapabilities
  },
  {
    id: 'relay',
    displayName: '自定义中转站',
    baseUrl: 'https://',
    defaultModel: '',
    capabilities: commonCapabilities
  }
]
