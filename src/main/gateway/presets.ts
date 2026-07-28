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
    defaultModel: 'deepseek-v4-flash',
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
    defaultModel: '请填写推理接入点 ID',
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
