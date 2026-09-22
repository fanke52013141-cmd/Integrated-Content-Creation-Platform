import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2, ClipboardList, CloudUpload, KeyRound, Lightbulb, LoaderCircle, RotateCcw, Save, Send, TestTube2, UploadCloud
} from 'lucide-react'
import type { AccountProfileSummary, Article, ArticleLayout, Publication, VisualAsset, WechatPublishChannel } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { Select } from '../components/Select'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { errorMessage, formatDate, isSafeUrl, markdownTitle } from '../lib'
import { useReportWork } from '../active-work'

const statusNames: Record<Publication['status'], { label: string; badge: string }> = {
  draft: { label: '草稿箱', badge: 'primary' },
  published: { label: '已发布', badge: 'success' },
  failed: { label: '推送失败', badge: 'danger' }
}

export function PublishingPage({ onNavigate, focusArticleId, currentAccount, showToast }: {
  onNavigate(route: RouteId, params?: Record<string, string>): void
  focusArticleId?: string
  currentAccount?: AccountProfileSummary
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

  useReportWork(selectedLayoutArticle ? {
    articleId: selectedLayoutArticle.id,
    title: markdownTitle(selectedLayoutArticle.rawMarkdown),
    accountId: selectedLayoutArticle.accountId,
    versionCount: selectedLayoutArticle.versionCount,
    status: selectedLayoutArticle.status
  } : {}, 'publishing')

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
      } catch (error) {
        if (!cancelled) {
          setCoverAssets([])
          showToast({ type: 'error', message: `封面素材加载失败：${errorMessage(error)}` })
        }
      }
    })()
    return () => { cancelled = true }
  }, [selectedLayout?.articleId, publications.length])

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [])

  // 作者默认当前账号名；摘要默认文章首段（字段为空时才预填，可随时改）
  useEffect(() => {
    setAuthor((current) => current || currentAccount?.name || '')
  }, [currentAccount?.name])
  useEffect(() => {
    const article = selectedLayoutArticle
    if (!article || digest) return
    const paragraph = article.rawMarkdown
      .split('\n')
      .map((line) => line.replace(/^#+\s*/, '').replace(/[*_>`~[\]]/g, '').trim())
      .find((line) => line.length > 10)
    if (paragraph) setDigest(paragraph.slice(0, 120))
  }, [selectedLayoutArticle?.id, digest])

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

  /** 阶段D：人工复盘「目标/结果/经验」，经验可一键写进账号记忆 */
  const saveRetro = async (publication: Publication, retro: { goal: string; result: string; lesson: string }): Promise<void> => {
    try {
      await window.moliu.publishing.saveRetro({ id: publication.id, ...retro })
      await refresh()
      showToast({ type: 'success', message: '发布复盘已保存' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  const rememberLesson = async (publication: Publication, lesson: string): Promise<void> => {
    const profileId = articles.find((article) => article.id === publication.articleId)?.accountId ?? currentAccount?.id
    if (!profileId) return showToast({ type: 'error', message: '这篇文章还没有绑定账号定位' })
    try {
      const result = await window.moliu.accounts.addMemory({ profileId, insight: lesson, source: '发布复盘' })
      showToast(result.created
        ? { type: 'success', message: '经验已写入账号记忆' }
        : { type: 'info', message: '同样的经验之前已经记过' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  /** 受控打开系统浏览器：统一走主进程 openExternal，渲染层不新建窗口 */
  const openUrl = (url: string): void => {
    void window.moliu.app.openExternal(url)
      .then((ok) => { if (!ok) showToast({ type: 'error', message: '无法打开链接：仅支持 http/https 地址' }) })
      .catch((error) => showToast({ type: 'error', message: `打开链接失败：${errorMessage(error)}` }))
  }

  /** 手动把选中的封面图片资产上传到公众号素材库并回填 media_id */
  const uploadCover = async (): Promise<void> => {
    if (!coverAssetId) return
    setBusy(true)
    try {
      const updated = await window.moliu.publishing.uploadWechatCover({ assetId: coverAssetId })
      setCoverAssets((current) => current.map((asset) => (asset.id === updated.id ? updated : asset)))
      showToast({ type: 'success', message: '封面已上传，发布时将使用该素材' })
    } catch (error) {
      showToast({ type: 'error', message: `封面上传失败：${errorMessage(error)}` })
    } finally {
      setBusy(false)
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
          {versionMismatch && <p className="visual-warning">所选排版稿不是该文章的当前版本。请回到「文章排版」重新生成后再推送，避免发布旧正文。</p>}
          <footer className="publish-section-foot">
            {!channelReady && <span className="micro-copy">请先完成第一步并保存连接。</span>}
            {versionMismatch && <span className="micro-copy">当前排版稿已过期，重新排版后即可推送。</span>}
            {!coverReady && channelReady && <span className="micro-copy">请在「智能配图」生成封面，或手动填写素材标识。</span>}
            {coverAssetId && <span className="micro-copy">推送时会自动上传所选封面；也可先手动上传。</span>}
            <span style={{ flex: 1 }} />
            <button className="button ghost compact" disabled={busy || !coverAssetId} onClick={() => void uploadCover()} title="上传到公众号素材库并回填素材标识"><UploadCloud size={14} />上传封面素材</button>
            <button
              className="button primary large"
              disabled={busy || !channelReady || !layoutId || !coverReady || Boolean(versionMismatch)}
              onClick={() => void push()}
              title={!channelReady ? '先保存公众号连接' : versionMismatch ? '请重新生成当前文章版本的排版稿' : !coverReady ? '缺少封面图片' : undefined}
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
              canRemember={Boolean(articles.find((article) => article.id === item.articleId)?.accountId ?? currentAccount)}
              onUrl={(value) => setUrls((current) => ({ ...current, [item.id]: value }))}
              onPublished={() => markPublished(item)}
              onRetry={() => retry(item)}
              onOpen={openUrl}
              onSaveRetro={(retro) => saveRetro(item, retro)}
              onRemember={(lesson) => rememberLesson(item, lesson)}
              busy={busy}
            />
          )) : (
            <EmptyState icon={Send} title="暂无发布记录" description="完成第一次推送后，记录会显示在这里。" />
          )}
        </section>
  </div>
}

function PublicationRow({ item, url, canRemember, onUrl, onPublished, onRetry, onOpen, onSaveRetro, onRemember, busy }: {
  item: Publication
  url: string
  canRemember: boolean
  onUrl(value: string): void
  onPublished(): Promise<void>
  onRetry(): Promise<void>
  onOpen(url: string): void
  onSaveRetro(retro: { goal: string; result: string; lesson: string }): Promise<void>
  onRemember(lesson: string): Promise<void>
  busy: boolean
}): React.JSX.Element {
  const status = statusNames[item.status]
  const [retro, setRetro] = useState({ goal: item.retro?.goal ?? '', result: item.retro?.result ?? '', lesson: item.retro?.lesson ?? '' })
  const [savingRetro, setSavingRetro] = useState(false)
  const unchanged = retro.goal === (item.retro?.goal ?? '') && retro.result === (item.retro?.result ?? '') && retro.lesson === (item.retro?.lesson ?? '')
  const hasRetro = Boolean(item.retro)
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
          <button className="button ghost compact" onClick={() => onOpen('https://mp.weixin.qq.com/')}>公众号后台</button>
          <button className="button secondary compact" disabled={!url.trim()} onClick={() => void onPublished()}><CheckCircle2 size={14} />标记已发布</button>
        </div>
      ) : item.status === 'failed' ? (
        <button className="button secondary compact" disabled={busy} onClick={() => void onRetry()}><RotateCcw size={14} />重推</button>
      ) : item.publishedUrl ? (
        isSafeUrl(item.publishedUrl)
          ? <button className="button ghost compact" onClick={() => onOpen(item.publishedUrl ?? '')}>查看文章</button>
          : <span className="break-all">{item.publishedUrl}</span>
      ) : null}
      <details className="publication-retro" open={hasRetro}>
        <summary><ClipboardList size={14} />发布复盘{hasRetro ? '' : '（目标 / 结果 / 经验）'}</summary>
        <label className="field"><span>目标</span><input name="retroGoal" autoComplete="off" value={retro.goal} maxLength={2000} onChange={(event) => setRetro((current) => ({ ...current, goal: event.target.value }))} placeholder="这篇发出去想达成什么？" /></label>
        <label className="field"><span>结果</span><input name="retroResult" autoComplete="off" value={retro.result} maxLength={2000} onChange={(event) => setRetro((current) => ({ ...current, result: event.target.value }))} placeholder="阅读、涨粉或转化，写下真实数字" /></label>
        <label className="field"><span>经验</span><textarea name="retroLesson" rows={2} value={retro.lesson} maxLength={2000} onChange={(event) => setRetro((current) => ({ ...current, lesson: event.target.value }))} placeholder="下次要保留或改掉什么？" /></label>
        <footer>
          <button
            className="button secondary compact"
            disabled={unchanged || savingRetro}
            onClick={() => { setSavingRetro(true); void onSaveRetro(retro).finally(() => setSavingRetro(false)) }}
          >
            {savingRetro ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}保存复盘
          </button>
          {item.retro?.lesson && (
            <button className="button ghost compact" disabled={!canRemember} title={canRemember ? '把这条经验写入账号记忆' : '这篇文章还没有绑定账号定位'} onClick={() => void onRemember(item.retro?.lesson ?? '')}>
              <Lightbulb size={14} />记为账号经验
            </button>
          )}
        </footer>
      </details>
    </div>
  )
}
