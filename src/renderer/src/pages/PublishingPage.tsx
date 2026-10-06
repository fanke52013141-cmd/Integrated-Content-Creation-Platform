import { LocalImageImport } from '../components/LocalImageImport'
import { useEffect, useState } from 'react'
import { CheckCircle2, ClipboardList, CloudUpload, KeyRound, Lightbulb, LoaderCircle, RotateCcw, Save, Send, TestTube2, UploadCloud } from 'lucide-react'
import type { AccountProfileSummary, ArticleSummary, ArticleLayout, DeliveryCheck, Publication, VisualAsset, WechatPublishChannel } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { useSelectedArticle } from '../hooks/useSelectedArticle'
import { ArticlePicker } from '../components/ArticlePicker'
import { Select } from '../components/Select'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { SavedVersionGate } from '../components/SavedVersionGate'
import { errorMessage, formatDate, isSafeUrl, markdownTitle, sanitizeHtml } from '../lib'
import { useReportWork } from '../active-work'
import { usePublishForm } from '../hooks/usePublishForm'
import { useWorkDraft } from '../hooks/useWorkDraft'

const statusNames: Record<Publication['status'], { label: string; badge: string }> = {
  draft: { label: '草稿箱', badge: 'primary' }, published: { label: '已发布', badge: 'success' },
  failed: { label: '推送失败', badge: 'danger' }, unknown: { label: '结果待确认', badge: 'warning' }
}

export function PublishingPage({ onNavigate, focusArticleId, currentAccount, showToast }: {
  onNavigate(route: RouteId, params?: Record<string, string>): void; focusArticleId?: string; currentAccount?: AccountProfileSummary; showToast(toast: ToastState): void
}): React.JSX.Element {
  const [channel, setChannel] = useState<WechatPublishChannel>()
  const [articles, setArticles] = useState<ArticleSummary[]>([])
  const [layouts, setLayouts] = useState<ArticleLayout[]>([])
  const [publications, setPublications] = useState<Publication[]>([])
  const [assets, setAssets] = useState<{ articleId: string; items: VisualAsset[] }>({ articleId: '', items: [] })
  const [appId, setAppId] = useState('')
  const [secret, setSecret] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [layoutId, setLayoutId] = useState('')
  const [busy, setBusy] = useState(false)
  const [channelOpen, setChannelOpen] = useState(true)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [check, setCheck] = useState<DeliveryCheck>()
  const [checking, setChecking] = useState(false)
  const wechatLayouts = layouts.filter(item => item.platform === 'wechat')
  const selectedLayout = wechatLayouts.find(item => item.id === layoutId)
  const { article, error: selectionError } = useSelectedArticle(selectedLayout?.articleId ?? focusArticleId ?? '', articles)
  const coverAssets = assets.articleId === article?.id ? assets.items : []
  const authorDefault = articles.find(item => item.id === article?.id)?.accountId === currentAccount?.id ? currentAccount?.name ?? '' : ''
  const { form, loaded, error: formError, update } = usePublishForm(article, channel?.appId ?? '', layoutId, authorDefault)
  const draft = useWorkDraft(article?.id ?? '', article?.rawMarkdown ?? '', article?.currentVersionId ?? '')
  const selectedCover = coverAssets.find(item => item.id === form.coverAssetId)
  const channelReady = Boolean(channel?.enabled && channel.hasAppSecret && channel.appId && channel.lastTestStatus === 'success')
  const input = { articleId: article?.id ?? '', layoutId, appId: channel?.appId, coverAssetId: selectedCover?.id, thumbMediaId: selectedCover ? undefined : form.thumbMediaId.trim() || undefined,
    author: form.author.trim() || undefined, digest: form.digest.trim() || undefined, contentSourceUrl: form.contentSourceUrl.trim() || undefined }
  useReportWork(article ? { articleId: article.id, title: markdownTitle(article.rawMarkdown), accountId: article.accountId, versionCount: article.versionCount, status: article.status, savedMarkdown: article.rawMarkdown, currentVersionId: article.currentVersionId } : {}, 'publishing')

  const refresh = async (): Promise<void> => {
    const [nextChannel, result, nextLayouts, nextPublications] = await Promise.all([
      window.moliu.publishing.getWechatChannel(), window.moliu.articles.listSummaries({ limit: 30 }), window.moliu.layouts.list(), window.moliu.publishing.list()
    ])
    setChannel(nextChannel); setArticles(result.items); setLayouts(nextLayouts); setPublications(nextPublications)
    setAppId(nextChannel.appId); setEnabled(nextChannel.enabled)
    setLayoutId(current => {
      if (current && nextLayouts.some(item => item.id === current && item.platform === 'wechat')) return current
      if (focusArticleId) return nextLayouts.find(item => item.platform === 'wechat' && item.articleId === focusArticleId)?.id ?? ''
      return nextLayouts.find(item => item.platform === 'wechat')?.id ?? ''
    })
    if (nextChannel.lastTestStatus === 'success') setChannelOpen(false)
  }
  useEffect(() => { setLayoutId(''); void refresh().catch(reason => showToast({ type: 'error', message: errorMessage(reason) })) }, [focusArticleId])
  useEffect(() => {
    let alive = true
    if (!article) { setAssets({ articleId: '', items: [] }); return }
    const id = article.id
    void window.moliu.visuals.list(id).then(packs => Promise.all(packs.map(pack => window.moliu.visuals.listAssets(pack.id)))).then(groups => {
      if (alive) setAssets({ articleId: id, items: groups.flat().filter(asset => asset.kind === 'cover') })
    }).catch(reason => { if (alive) showToast({ type: 'error', message: `封面读取失败：${errorMessage(reason)}` }) })
    return () => { alive = false }
  }, [article?.id, publications.length])
  useEffect(() => {
    let alive = true
    setCheck(undefined)
    if (!loaded || !article || !selectedLayout) { setChecking(false); return }
    setChecking(true)
    const timer = window.setTimeout(() => {
      void window.moliu.publishing.preflight(input).then(value => { if (alive) setCheck(value) })
        .catch(reason => { if (alive) setCheck({ ready: false, issues: [errorMessage(reason)], localImageCount: 0, title: selectedLayout.title, articleVersionNumber: article.versionCount, appId: channel?.appId ?? '' }) })
        .finally(() => { if (alive) setChecking(false) })
    }, 200)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [loaded, article?.id, article?.currentVersionId, layoutId, channel?.appId, channel?.enabled, form.coverAssetId, form.thumbMediaId, form.author, form.digest, form.contentSourceUrl, selectedCover?.id, draft.dirty, draft.status])

  const perform = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try { await operation() } catch (reason) { showToast({ type: 'error', message: errorMessage(reason) }) }
    finally { setBusy(false) }
  }
  const save = () => perform(async () => {
    await window.moliu.publishing.saveWechatChannel({ appId: appId.trim(), appSecret: secret.trim() || undefined, enabled })
    setSecret(''); await refresh(); showToast({ type: 'success', message: enabled ? '公众号已验证并加密保存' : '公众号连接已停用' })
  })
  const test = () => perform(async () => {
    const result = await window.moliu.publishing.testWechatChannel({ appId: appId.trim(), appSecret: secret.trim() || undefined, enabled })
    showToast({ type: 'success', message: `${result.message} · ${result.latencyMs}ms` })
  })
  const report = async (result: Publication): Promise<void> => {
    await refresh()
    showToast({ type: result.status === 'draft' ? 'success' : result.status === 'unknown' ? 'warning' : 'error', message: result.status === 'draft' ? '已进入公众号草稿箱，请到公众号后台正式发布' : result.errorMessage ?? '推送未完成' })
  }
  const push = () => perform(async () => { await draft.flush(); await report(await window.moliu.publishing.pushWechatDraft(input)) })
  const retry = (publication: Publication) => perform(async () => { await report(await window.moliu.publishing.retry(publication.id)) })
  const markPublished = async (publication: Publication): Promise<void> => {
    const url = urls[publication.id]?.trim(); if (!url) return
    await perform(async () => { await window.moliu.publishing.update({ id: publication.id, status: 'published', publishedUrl: url }); await refresh(); showToast({ type: 'success', message: '发布链接已记录' }) })
  }
  const saveRetro = async (publication: Publication, retro: { goal: string; result: string; lesson: string; metrics?: import('../../../shared/contracts').PublicationMetrics }): Promise<void> => {
    await perform(async () => { await window.moliu.publishing.saveRetro({ id: publication.id, ...retro }); await refresh(); showToast({ type: 'success', message: '发布复盘已保存' }) })
  }
  const rememberLesson = async (publication: Publication, lesson: string): Promise<void> => {
    const profileId = (await window.moliu.articles.getSummary(publication.articleId))?.accountId
    if (!profileId) return showToast({ type: 'error', message: '这篇文章还没有绑定账号定位' })
    await perform(async () => { const result = await window.moliu.accounts.addMemory({ profileId, insight: lesson, source: '发布复盘' }); showToast({ type: 'info', message: result.created ? '经验已写入账号记忆' : '这条经验已经记录过' }) })
  }
  const openUrl = (url: string): void => { void window.moliu.app.openExternal(url).catch(reason => showToast({ type: 'error', message: errorMessage(reason) })) }
  const uploadCover = () => perform(async () => {
    if (!selectedCover) return
    const updated = await window.moliu.publishing.uploadWechatCover({ assetId: selectedCover.id })
    setAssets(current => ({ ...current, items: current.items.map(asset => asset.id === updated.id ? updated : asset) }))
    showToast({ type: 'success', message: '封面已上传到当前公众号' })
  })

  return <div className="page publishing-page">
    <PageHeader route="publishing" onNavigate={onNavigate} title="排版交付" description="核对当前作品，推送公众号草稿箱，再记录正式发布链接" />
    {selectionError && <p className="inline-alert" role="alert">{selectionError}</p>}
    <SavedVersionGate article={article} onSaved={refresh} onNavigate={onNavigate} />
    <section className="publish-channel">
      <header className="publish-section-head"><div><h3><KeyRound size={16} />公众号连接</h3><p>{channelReady ? `当前目标：${channel?.appId}` : '连接验证成功后才能推送；也可以在排版页导出文件。'}</p></div>
        <span className={`status-pill ${channelReady ? 'success' : 'muted'}`}>{channelReady ? '验证通过' : channel?.lastTestStatus === 'failure' ? '验证失败' : channel?.hasAppSecret ? '待验证' : '未配置'}</span>
        <button className="text-button" onClick={() => setChannelOpen(value => !value)}>{channelOpen ? '收起配置' : '修改连接'}</button></header>
      {channelOpen && <>
        <p className="micro-copy">在公众号后台「设置与开发 → 基本配置」获取凭证，并将当前公网 IP 加入白名单。</p>
        <div className="publish-fields">
          <label className="field"><span>AppID</span><input name="appId" disabled={busy} autoComplete="off" value={appId} onChange={event => setAppId(event.target.value)} /></label>
          <label className="field"><span>AppSecret {channel?.hasAppSecret && <em>同一公众号留空保留密钥</em>}</span><input type="password" name="appSecret" disabled={busy} autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} /></label>
          <label className="publish-enabled"><input type="checkbox" disabled={busy} checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用连接</label>
        </div>
        <footer className="publish-section-foot"><span className="micro-copy">测试使用当前表单；启用连接前会验证并加密保存。</span><span style={{ flex: 1 }} />
          <button className="button ghost" disabled={busy} onClick={() => void test()}><TestTube2 size={14} />测试当前配置</button>
          <button className="button primary" disabled={busy || !appId.trim()} onClick={() => void save()}><Save size={14} />{enabled ? '验证并保存' : '保存并停用'}</button></footer>
      </>}
    </section>
    <section className="publish-draft">
      <header className="publish-section-head"><div><h3><CloudUpload size={16} />交付预览</h3><p>每篇文章独立保存封面、作者和摘要，切换作品不会混用。</p></div></header>
      <div className="publish-draft-grid">
        <label className="field"><span>排版稿</span><Select value={layoutId} disabled={busy} onChange={setLayoutId} ariaLabel="排版稿" options={wechatLayouts.map(item => ({ value: item.id, label: item.title, hint: formatDate(item.createdAt) }))} /></label>
        <label className="field"><span>封面图片</span><Select value={selectedCover?.id ?? ''} onChange={value => update({ coverAssetId: value, thumbMediaId: '' })} disabled={!loaded || busy} ariaLabel="封面图片" placeholder="选择当前文章的封面" options={coverAssets.map(asset => ({ value: asset.id, label: asset.prompt.slice(0, 40) || '封面图片' }))} /></label>
        <label className="field"><span>作者</span><input name="author" disabled={!loaded || busy} value={form.author} onChange={event => update({ author: event.target.value })} maxLength={100} /></label>
        <label className="field"><span>摘要</span><input name="digest" disabled={!loaded || busy} value={form.digest} onChange={event => update({ digest: event.target.value })} maxLength={120} /></label>
        <label className="field"><span>原文链接（可选）</span><input type="url" name="sourceUrl" disabled={!loaded || busy} value={form.contentSourceUrl} onChange={event => update({ contentSourceUrl: event.target.value })} /></label>
      </div>
      {article && <LocalImageImport articleId={article.id} kind="cover" onImported={asset => { setAssets(current => ({ articleId: article.id, items: [...current.items, asset] })); update({ coverAssetId: asset.id, thumbMediaId: '' }) }} />}
      <details className="composer-advanced"><summary>已有公众号素材标识？手动填写</summary><label className="field"><span>封面素材标识</span><input name="thumbMediaId" disabled={!loaded || busy} value={form.thumbMediaId} onChange={event => update({ thumbMediaId: event.target.value, coverAssetId: '' })} /></label></details>
      {selectedLayout ? <div className="delivery-preview">
        <div><strong>{selectedLayout.title}</strong><p className="micro-copy">正文第 {article?.versionCount} 版 · 目标公众号 {channel?.appId || '未配置'} · {check?.localImageCount ?? 0} 张本地正文图片将在推送时上传</p>
          {selectedCover?.url && <img className="delivery-cover" src={selectedCover.url} alt="将要交付的封面" />}</div>
        <details><summary>查看正文排版</summary><article className="layout-preview-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedLayout.html) }} /></details>
      </div> : <EmptyState icon={Send} title="还没有可交付的排版稿" description="生成一份当前文章的微信公众号排版稿后继续。" actionLabel="去排版" onAction={() => onNavigate('layouts', article ? { articleId: article.id } : undefined)} />}
      {formError && <p className="inline-alert">{formError}</p>}
      {check && !check.ready && <ul className="delivery-issues" role="status">{check.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      <footer className="publish-section-foot"><span className="micro-copy">{checking ? '正在检查交付内容…' : check?.ready ? '内容检查通过，推送后还需在公众号后台正式发布。' : '请完成上方检查项目。'}</span><span style={{ flex: 1 }} />
        {article && !selectedCover && <button className="button secondary compact" onClick={() => onNavigate('visuals', { articleId: article.id })}>为这篇文章准备封面</button>}
        <button className="button ghost compact" disabled={busy || !selectedCover || !channelReady} onClick={() => void uploadCover()}><UploadCloud size={14} />上传封面</button>
        <button className="button primary large" disabled={busy || !loaded || !channelReady || !check?.ready || checking || draft.dirty || draft.status !== 'saved' || Boolean(formError)} onClick={() => void push()}>{busy ? <LoaderCircle size={16} className="spin" /> : <CloudUpload size={16} />}{busy ? '正在推送…' : '推送草稿箱'}</button>
      </footer>
    </section>
    <section className="publication-log"><header className="publish-section-head"><div><h3><Send size={16} />交付记录与复盘</h3><p>推送到草稿箱与正式发布分别记录；结果待确认时请先核对公众号后台。</p></div></header>
      {publications.length ? publications.map(item => <PublicationRow key={item.id} item={item} url={urls[item.id] ?? ''} canRemember={true}
        onUrl={value => setUrls(current => ({ ...current, [item.id]: value }))} onPublished={() => markPublished(item)} onRetry={() => retry(item)} onOpen={openUrl}
        onResolve={(decision, note, remoteId) => perform(async () => { await window.moliu.publishing.resolveUnknown({ id: item.id, decision, note, remoteId: remoteId || undefined, expectedUpdatedAt: item.updatedAt }); await refresh() })}
        onSaveRetro={retro => saveRetro(item, retro)} onRemember={lesson => rememberLesson(item, lesson)} busy={busy} />)
        : <EmptyState icon={Send} title="暂无交付记录" description="第一次推送后会保存完整交付快照。" />}
    </section>
  </div>
}

function PublicationRow({ item, url, canRemember, onUrl, onPublished, onRetry, onOpen, onSaveRetro, onRemember, onResolve, busy }: {
  item: Publication
  url: string
  canRemember: boolean
  onUrl(value: string): void
  onPublished(): Promise<void>
  onRetry(): Promise<void>
  onOpen(url: string): void
  onSaveRetro(retro: { goal: string; result: string; lesson: string; metrics?: import('../../../shared/contracts').PublicationMetrics }): Promise<void>
  onResolve(decision: 'received' | 'not-received' | 'unresolved', note: string, remoteId: string): Promise<void>
  onRemember(lesson: string): Promise<void>
  busy: boolean
}): React.JSX.Element {
  const [resolutionNote, setResolutionNote] = useState('')
  const [remoteId, setRemoteId] = useState('')
  const [decision, setDecision] = useState<'received' | 'not-received' | 'unresolved'>('unresolved')
  const status = statusNames[item.status]
  const [retro, setRetro] = useState({ goal: item.retro?.goal ?? '', result: item.retro?.result ?? '', lesson: item.retro?.lesson ?? '', metrics: item.retro?.metrics ?? {} })
  const [savingRetro, setSavingRetro] = useState(false)
  const unchanged = retro.goal === (item.retro?.goal ?? '') && retro.result === (item.retro?.result ?? '') && retro.lesson === (item.retro?.lesson ?? '') && JSON.stringify(retro.metrics) === JSON.stringify(item.retro?.metrics ?? {})
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
        {item.resolution && <small>人工核对：{formatDate(item.resolution.checkedAt)} · {item.resolution.note}</small>}
        {item.retryOf && <small>本次重推源自记录 {item.retryOf.slice(0, 8)}</small>}
      </div>
      {item.status === 'unknown' ? <div className="publication-actions">
        <button className="button ghost compact" onClick={() => onOpen('https://mp.weixin.qq.com/')}>打开草稿箱核对</button>
        <label className="field"><span>核对结果</span><select value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="unresolved">仍不确定，禁止重推</option><option value="received">确认已收到</option><option value="not-received">确认未收到，允许重推</option></select></label>
        <input aria-label="核对说明" value={resolutionNote} onChange={event => setResolutionNote(event.target.value)} placeholder="核对时间、公众号及判断依据" maxLength={2000} />
        <input aria-label="远端草稿标识" value={remoteId} onChange={event => setRemoteId(event.target.value)} placeholder="已收到的草稿标识（选填）" maxLength={200} />
        <button className="button secondary compact" disabled={busy || !resolutionNote.trim()} onClick={() => void onResolve(decision, resolutionNote, remoteId)}>保存核对结果</button>
      </div> : item.status === 'draft' ? (
        <div className="publication-actions">
          <input type="url" inputMode="url" name="publishedUrl" autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={url} onChange={(event) => onUrl(event.target.value)} placeholder="粘贴正式文章链接…" />
          <button className="button ghost compact" onClick={() => onOpen('https://mp.weixin.qq.com/')}>公众号后台</button>
          <button className="button secondary compact" disabled={busy || !url.trim()} onClick={() => void onPublished()}><CheckCircle2 size={14} />标记已发布</button>
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
        <div className="publish-draft-grid">{([['reads', '阅读次数'], ['shares', '分享次数'], ['followers', '新增关注'], ['conversions', '转化次数']] as const).map(([key, label]) => <label className="field" key={key}><span>{label}（选填）</span><input type="number" min="0" step="1" max="1000000000000" value={retro.metrics[key] ?? ''} onChange={event => setRetro(current => ({ ...current, metrics: { ...current.metrics, [key]: event.target.value === '' ? undefined : Number(event.target.value) } }))} /></label>)}<label className="field"><span>统计截止日期</span><input type="date" value={retro.metrics.cutoff ?? ''} onChange={event => setRetro(current => ({ ...current, metrics: { ...current.metrics, cutoff: event.target.value || undefined } }))} /></label></div>
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
