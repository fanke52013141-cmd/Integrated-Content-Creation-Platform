import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2, CloudUpload, KeyRound, LoaderCircle, RotateCcw, Save, Send, TestTube2
} from 'lucide-react'
import type { Article, ArticleLayout, Publication, VisualAsset, WechatPublishChannel } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { Select } from '../components/Select'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { errorMessage, formatDate, isSafeUrl } from '../lib'

const statusNames: Record<Publication['status'], { label: string; badge: string }> = {
  draft: { label: '草稿箱', badge: 'primary' },
  published: { label: '已发布', badge: 'success' },
  failed: { label: '推送失败', badge: 'danger' }
}

export function PublishingPage({ onNavigate, focusArticleId, showToast }: {
  onNavigate(route: RouteId, params?: Record<string, string>): void
  focusArticleId?: string
  showToast(toast: ToastState): void
}): React.JSX.Element {
  const [channel, setChannel] = useState<WechatPublishChannel>()
  const [articles, setArticles] = useState<Article[]>([])
  const [layouts, setLayouts] = useState<ArticleLayout[]>([])
  const [publications, setPublications] = useState<Publication[]>([])
  const [coverAssets, setCoverAssets] = useState<VisualAsset[]>([])
  const [appId, setAppId] = useState('')
  const [secret, setSecret] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [layoutId, setLayoutId] = useState('')
  const [coverAssetId, setCoverAssetId] = useState('')
  const [manualMediaId, setManualMediaId] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [author, setAuthor] = useState('')
  const [digest, setDigest] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [urls, setUrls] = useState<Record<string, string>>({})

  const wechatLayouts = useMemo(() => layouts.filter((item) => item.platform === 'wechat'), [layouts])
  const selectedLayout = wechatLayouts.find((item) => item.id === layoutId)
  const selectedLayoutArticle = articles.find((item) => item.id === selectedLayout?.articleId)
  const channelReady = Boolean(channel?.enabled && channel?.hasAppSecret && channel?.appId)
  const coverReady = Boolean(coverAssetId || manualMediaId.trim())

  const refresh = async (): Promise<void> => {
    const [nextChannel, nextArticles, nextLayouts, nextPublications] = await Promise.all([
      window.moliu.publishing.getWechatChannel(), window.moliu.articles.list(), window.moliu.layouts.list(), window.moliu.publishing.list()
    ])
    setChannel(nextChannel)
    setArticles(nextArticles)
    setLayouts(nextLayouts)
    setPublications(nextPublications)
    setAppId(nextChannel.appId)
    setEnabled(nextChannel.enabled)
    setLayoutId((current) => {
      if (nextLayouts.some((item) => item.id === current && item.platform === 'wechat')) return current
      if (focusArticleId) {
        const match = nextLayouts.find((item) => item.platform === 'wechat' && item.articleId === focusArticleId)
        if (match) return match.id
      }
      return nextLayouts.find((item) => item.platform === 'wechat')?.id ?? ''
    })
  }

  // 加载所选排版稿对应文章的封面图片资产
  useEffect(() => {
    if (!selectedLayout?.articleId) { setCoverAssets([]); return }
    let cancelled = false
    void (async () => {
      try {
        const packs = await window.moliu.visuals.list(selectedLayout.articleId)
        const assets = (await Promise.all(packs.map((pack) => window.moliu.visuals.listAssets(pack.id)))).flat()
        if (!cancelled) setCoverAssets(assets)
      } catch {
        if (!cancelled) setCoverAssets([])
      }
    })()
    return () => { cancelled = true }
  }, [selectedLayout?.articleId, publications.length])

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.moliu.publishing.saveWechatChannel({ appId: appId.trim(), appSecret: secret.trim() || undefined, enabled })
      setSecret('')
      await refresh()
      showToast({ type: 'success', message: '公众号连接已加密保存' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.moliu.publishing.testWechatChannel()
      showToast({ type: 'success', message: `${result.message} · ${result.latencyMs}ms` })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const push = async (): Promise<void> => {
    if (!selectedLayout) return
    setBusy(true)
    try {
      const result = await window.moliu.publishing.pushWechatDraft({
        articleId: selectedLayout.articleId,
        layoutId: selectedLayout.id,
        coverAssetId: coverAssetId || undefined,
        thumbMediaId: (!coverAssetId && manualMediaId.trim()) || undefined,
        author: author.trim() || undefined,
        digest: digest.trim() || undefined,
        contentSourceUrl: sourceUrl.trim() || undefined
      })
      await refresh()
      if (result.status === 'draft') {
        showToast({ type: 'success', message: '已推送到公众号草稿箱，请到 mp.weixin.qq.com 群发或定时发布' })
      } else {
        showToast({ type: 'error', message: result.errorMessage || '推送失败' })
      }
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const retry = async (publication: Publication): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.moliu.publishing.pushWechatDraft({
        articleId: publication.articleId,
        layoutId: publication.layoutId,
        thumbMediaId: publication.thumbMediaId || undefined
      })
      await refresh()
      showToast(result.status === 'draft' ? { type: 'success', message: '重推成功，已进入草稿箱' } : { type: 'error', message: result.errorMessage || '重推失败' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const markPublished = async (publication: Publication): Promise<void> => {
    const url = urls[publication.id]?.trim()
    if (!url) return
    try {
      await window.moliu.publishing.update({ id: publication.id, status: 'published', publishedUrl: url })
      await refresh()
      showToast({ type: 'success', message: '发布链接已记录' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  const versionMismatch = selectedLayout && selectedLayoutArticle && selectedLayout.articleVersionId !== selectedLayoutArticle.currentVersionId

  return <div className="page publishing-page">
    <PageHeader
      route="publishing"
      onNavigate={onNavigate}
      title="发布管理"
      description="配置公众号 → 选封面 → 推送草稿箱 → 记录正式链接"
    />

    {!layouts.length && (
      <p className="inline-alert"><Send size={14} />还没有可发布的排版稿：先在「文章排版」生成一份微信公众号排版稿，下方三步即可走通。</p>
    )}

    <section className="publish-channel">
          <header className="publish-section-head">
            <div>
              <h3><KeyRound size={16} />第一步 · 连接公众号</h3>
              <p>AppID / AppSecret 来自 mp.weixin.qq.com「设置与开发 → 基本配置」，本机 IP 需加入白名单。</p>
            </div>
            <span className={`status-pill ${channelReady ? 'success' : 'muted'}`}>{channelReady ? '已连接' : '未配置'}</span>
          </header>
          <div className="publish-fields">
            <label className="field"><span>应用标识 AppID</span>
              <input name="appId" autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="wx 开头的应用标识" />
            </label>
            <label className="field"><span>应用密钥 AppSecret {channel?.hasAppSecret && <em>已保存，留空表示不修改</em>}</span>
              <input type="password" name="appSecret" autoComplete="new-password" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="公众号应用密钥" />
            </label>
            <label className="publish-enabled"><input type="checkbox" name="enabled" autoComplete="off" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用通道</label>
          </div>
          <footer className="publish-section-foot">
            <span className="micro-copy">密钥使用系统级加密存储，仅本机可解密。</span>
            <span style={{ flex: 1 }} />
            <button className="button ghost" disabled={busy} onClick={() => void test()}><TestTube2 size={14} />测试连接</button>
            <button className="button primary" disabled={busy} onClick={() => void save()}><Save size={14} />保存</button>
          </footer>
        </section>

        <section className="publish-draft">
          <header className="publish-section-head">
            <div>
              <h3><CloudUpload size={16} />第二步 · 推送草稿箱</h3>
              <p>封面会自动上传到公众号素材库并回填素材标识。</p>
            </div>
          </header>
          <div className="publish-draft-grid">
            <label className="field"><span>排版稿</span>
              <Select value={layoutId} onChange={setLayoutId} ariaLabel="排版稿" options={wechatLayouts.map((item) => ({ value: item.id, label: item.title, hint: formatDate(item.createdAt) }))} />
            </label>
            <label className="field"><span>封面图片</span>
              <Select
                value={coverAssetId}
                onChange={setCoverAssetId}
                ariaLabel="封面图片"
                placeholder={coverAssets.length ? '选择配图方案的封面' : '暂无配图，可手动填写素材标识'}
                options={coverAssets.map((asset) => ({
                  value: asset.id,
                  label: asset.prompt.slice(0, 40) || (asset.source === 'generated' ? 'AI 生成封面' : '本地导入封面'),
                  hint: asset.wechatMediaId ? '已上传素材库' : '未上传'
                }))}
              />
            </label>
            <label className="field"><span>作者</span><input name="author" autoComplete="name" value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
            <label className="field"><span>摘要</span><input name="digest" autoComplete="off" value={digest} maxLength={120} onChange={(event) => setDigest(event.target.value)} /></label>
            <label className="field"><span>原文链接</span>
              <input type="url" inputMode="url" name="sourceUrl" autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://（可选）" />
            </label>
          </div>
          {!coverAssets.length && (
            <button className="text-button" onClick={() => setShowManual((value) => !value)}>
              {showManual ? '收起手动填写' : '没有封面图？手动填写公众号素材标识 thumbMediaId →'}
            </button>
          )}
          {(showManual || (!coverAssets.length && coverReady && !coverAssetId)) && (
            <label className="field"><span>封面素材标识（手动兜底）</span>
              <input name="thumbMediaId" autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={manualMediaId} onChange={(event) => setManualMediaId(event.target.value)} placeholder="从公众号素材库复制的 thumb_media_id" />
            </label>
          )}
          {versionMismatch && <p className="visual-warning">所选排版稿不是该文章的当前版本，推送内容会与最新草稿不一致。</p>}
          <footer className="publish-section-foot">
            {!channelReady && <span className="micro-copy">请先完成第一步并保存连接。</span>}
            {!coverReady && channelReady && <span className="micro-copy">请在「智能配图」生成封面，或手动填写素材标识。</span>}
            <span style={{ flex: 1 }} />
            <button
              className="button primary large"
              disabled={busy || !channelReady || !layoutId || !coverReady}
              onClick={() => void push()}
              title={!channelReady ? '先保存公众号连接' : !coverReady ? '缺少封面图片' : undefined}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <CloudUpload size={16} />}推送草稿箱
            </button>
          </footer>
        </section>

        <section className="publication-log">
          <header className="publish-section-head">
            <div>
              <h3><Send size={16} />第三步 · 发布记录</h3>
              <p>推送成功后到 mp.weixin.qq.com 群发，把正式链接回填到这里归档。</p>
            </div>
          </header>
          {publications.length ? publications.map((item) => (
            <PublicationRow
              key={item.id}
              item={item}
              url={urls[item.id] ?? ''}
              onUrl={(value) => setUrls((current) => ({ ...current, [item.id]: value }))}
              onPublished={() => markPublished(item)}
              onRetry={() => retry(item)}
              busy={busy}
            />
          )) : (
            <EmptyState icon={Send} title="暂无发布记录" description="完成第一次推送后，记录会显示在这里。" />
          )}
        </section>
  </div>
}

function PublicationRow({ item, url, onUrl, onPublished, onRetry, busy }: {
  item: Publication
  url: string
  onUrl(value: string): void
  onPublished(): Promise<void>
  onRetry(): Promise<void>
  busy: boolean
}): React.JSX.Element {
  const status = statusNames[item.status]
  return (
    <div className="publication-row">
      <div className="publication-main">
        <div className="publication-title">
          <strong>{item.title}</strong>
          <span className={`badge ${status.badge}`}>{status.label}</span>
        </div>
        <small>{formatDate(item.updatedAt)} · 封面 {item.thumbMediaId ? '已设置' : '未设置'}</small>
        {item.errorMessage && <em>{item.errorMessage}</em>}
      </div>
      {item.status === 'draft' ? (
        <div className="publication-actions">
          <input type="url" inputMode="url" name="publishedUrl" autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={url} onChange={(event) => onUrl(event.target.value)} placeholder="粘贴正式文章链接…" />
          <button className="button secondary compact" disabled={!url.trim()} onClick={() => void onPublished()}><CheckCircle2 size={14} />标记已发布</button>
        </div>
      ) : item.status === 'failed' ? (
        <button className="button secondary compact" disabled={busy} onClick={() => void onRetry()}><RotateCcw size={14} />重推</button>
      ) : item.publishedUrl ? (
        isSafeUrl(item.publishedUrl)
          ? <a href={item.publishedUrl} target="_blank" rel="noopener noreferrer" className="break-all">查看文章</a>
          : <span className="break-all">{item.publishedUrl}</span>
      ) : null}
    </div>
  )
}
