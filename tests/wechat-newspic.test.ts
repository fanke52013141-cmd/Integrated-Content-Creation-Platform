import { describe, expect, it } from 'vitest'
import { buildNewsPicDraftArticles } from '../src/main/services/wechat-publish-service.js'

/**
 * 小绿书（newspic）草稿请求体测试（阶段五验收）。
 *
 * 官方规则：image_info.image_list ≤20 张、首张即封面、要求永久 MediaID；
 * digest 留空时不带字段（微信自动抓取）。图片数组顺序即展示顺序。
 */

describe('小绿书草稿请求体', () => {
  it('article_type=newspic，图片顺序映射为 image_list，首张即封面', () => {
    const [article] = buildNewsPicDraftArticles({ title: '三步搞定排版', mediaIds: ['MEDIA_A', 'MEDIA_B', 'MEDIA_C'] }) as Array<Record<string, any>>
    expect(article.article_type).toBe('newspic')
    expect(article.title).toBe('三步搞定排版')
    const imageList = article.image_info.image_list as Array<{ image_media_id: string }>
    expect(imageList.map(item => item.image_media_id)).toEqual(['MEDIA_A', 'MEDIA_B', 'MEDIA_C'])
    expect(article.need_open_comment).toBe(0)
  })

  it('digest 留空时不携带字段（微信自动抓取）', () => {
    const [article] = buildNewsPicDraftArticles({ title: 'T', mediaIds: ['A'] }) as Array<Record<string, any>>
    expect('digest' in article).toBe(false)
    const [withDigest] = buildNewsPicDraftArticles({ title: 'T', digest: '摘要', mediaIds: ['A'] }) as Array<Record<string, any>>
    expect(withDigest.digest).toBe('摘要')
  })

  it('mediaIds 为空时 image_list 为空数组（服务层另有 ≥1 张的业务拦截）', () => {
    const [article] = buildNewsPicDraftArticles({ title: 'T', mediaIds: [] }) as Array<Record<string, any>>
    expect((article.image_info as { image_list: unknown[] }).image_list).toEqual([])
  })
})
