import { VisualStudio } from '../components/VisualStudio'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy, FileUp, Image as ImageIcon, ImagePlus, LayoutTemplate, LoaderCircle, Palette,
  Sparkles, Trash2, UploadCloud, X
} from 'lucide-react'
import type { ArticleSummary, ProviderSummary, VisualAsset, VisualPack, VisualPrompt, VisualAssetKind } from '../../../shared/contracts'
import type { RouteId } from '../components/Layout'
import type { ToastState } from '../components/Toast'
import { useSelectedArticle } from '../hooks/useSelectedArticle'
import { ArticlePicker } from '../components/ArticlePicker'
import { Select } from '../components/Select'
import { ImportDialog } from '../components/ImportDialog'
import { PageHeader, NextStepBar } from '../components/PageHeader'
import { SourceBadge } from '../components/SourceBadge'
import { EmptyState } from '../components/EmptyState'
import { StreamingPreview } from '../components/StreamingPreview'
import { useConfirm } from '../components/useConfirm'
import { ModalBase } from '../components/ModalBase'
import { useGenerationStream, isCancelError } from '../hooks/useGenerationStream'
import { useReportWork } from '../active-work'
import { useWorkDraft } from '../hooks/useWorkDraft'
import { SavedVersionGate } from '../components/SavedVersionGate'
import { availableModels, DEFAULT_IMAGE_MODEL_KEY, encodeModelTarget, useModelTarget } from '../lib/models'
import { errorMessage, formatDate, formatTimedDate, markdownTitle } from '../lib'
import { disambiguateOptions } from '../../../shared/creation-state'

/** 封面固定 21:9：PRD 原定的 2.35:1 不在供应商支持列表内，21:9 是最接近的横版比例 */
const COVER_RATIO = '21:9'
/** 生图默认质量与分辨率：产品默认 low + 1K（桌面端出图足够，成本最低） */
const IMAGE_QUALITY = 'low' as const
const IMAGE_RESOLUTION = '1k' as const

interface VisualsPageProps {
  providers: ProviderSummary[]
  onNavigate(route: RouteId, params?: Record<string, string>): void
  focusArticleId?: string
  showToast(toast: ToastState): void
}

export function VisualsPage({ providers, onNavigate, focusArticleId, showToast }: VisualsPageProps): React.JSX.Element {
  const stream = useGenerationStream('visuals')
  const { confirm, ConfirmPortal } = useConfirm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [articles, setArticles] = useState<ArticleSummary[]>([])
  const [packs, setPacks] = useState<VisualPack[]>([])
  const [articleId, setArticleId] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [studioMode, setStudioMode] = useState(true)
  const [importedPlanId, setImportedPlanId] = useState('')
  const [count, setCount] = useState(3)
  /** 透明背景：贴纸 / 图标类素材用，生成带 alpha 通道的 PNG */
  const [transparent, setTransparent] = useState(false)
  const [modelTarget, setModelTarget] = useModelTarget(availableModels(providers), undefined, 'visual.generate')
  const [assetsByPack, setAssetsByPack] = useState<Record<string, VisualAsset[]>>({})
  const [imageBusyKey, setImageBusyKey] = useState('')
  const [importTarget, setImportTarget] = useState<{ packId: string; kind: VisualAssetKind; slot: number; prompt: string } | null>(null)
  const [batchState, setBatchState] = useState<{ packId: string; done: number; total: number; phase: 'generate' | 'upload' } | null>(null)
  const batchStopRef = useRef(false)
  /** 参考图编辑：只有带远端 URL 的生成图才能改 */
  const [editTarget, setEditTarget] = useState<{ packId: string; kind: VisualAssetKind; slot: number; prompt: string; imageUrl: string; assetId?: string; transparent?: boolean } | null>(null)

  const imageModels = useMemo(
    () => providers
      .filter((provider) => provider.enabled && provider.hasApiKey && provider.capabilities.image)
      .flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({ provider, model }))),
    [providers]
  )
  const [imageTarget, setImageTarget] = useModelTarget(imageModels, DEFAULT_IMAGE_MODEL_KEY)
  const { article: selected, error: selectionError } = useSelectedArticle(articleId, articles)
  const currentPacks = useMemo(() => packs.filter((pack) => pack.articleId === articleId && pack.rawXml !== '<visual-studio/>'), [packs, articleId])

  const workDraft = useWorkDraft(selected?.id ?? '', selected?.rawMarkdown ?? '', selected?.currentVersionId ?? '')
  const needsSavedVersion = workDraft.dirty || workDraft.status !== 'saved'
  useReportWork(selected ? {
    articleId: selected.id,
    title: markdownTitle(selected.rawMarkdown),
    accountId: selected.accountId,
    versionCount: selected.versionCount,
    status: selected.status, savedMarkdown: selected.rawMarkdown, currentVersionId: selected.currentVersionId
  } : {}, 'visuals')

  const refresh = async (): Promise<void> => {
    const [nextArticles, nextPacks] = await Promise.all([window.moliu.articles.listSummaries({ limit: 30 }).then(result => result.items), window.moliu.visuals.list()])
    setArticles(nextArticles)
    setPacks(nextPacks)
    setArticleId((current) => {
      if (focusArticleId) return focusArticleId
      if (current) return current
      const locked = nextArticles.find((article) => article.status === 'locked')
      return locked?.id ?? (focusArticleId && nextArticles.some(item => item.id === focusArticleId) ? focusArticleId : nextArticles[0]?.id) ?? ''
    })
    await refreshAssets(nextPacks.filter((pack) => pack.articleId === articleId).map((pack) => pack.id))
  }

  const refreshAssets = async (packIds: string[]): Promise<void> => {
    const entries = await Promise.all(packIds.map(async (packId) => {
      return [packId, await window.moliu.visuals.listAssets(packId)] as const
    }))
    setAssetsByPack(Object.fromEntries(entries))
  }

  useEffect(() => { void refresh().catch((error) => showToast({ type: 'error', message: errorMessage(error) })) }, [focusArticleId])
  useEffect(() => { if (focusArticleId) setArticleId(focusArticleId) }, [focusArticleId])
  useEffect(() => { void refreshAssets(currentPacks.map((pack) => pack.id)).catch(() => undefined) }, [articleId, packs.length])

  const generatePlan = async (): Promise<void> => {
    const target = decodeTarget(modelTarget)
    if (!articleId || !target) return
    try {
      await stream.run(() => window.moliu.visuals.generate({ articleId, providerId: target.providerId, model: target.modelId, inlineCount: count }))
      await refresh()
      showToast({ type: 'success', message: '配图方案已生成，可逐张生成图片' })
    } catch (error) {
      showToast(isCancelError(error) ? { type: 'info', message: '已取消生成' } : { type: 'error', message: errorMessage(error) })
    }
  }

  const generateImage = async (pack: VisualPack, kind: VisualAssetKind, slot: number, prompt: string, ratio?: string): Promise<void> => {
    const target = decodeTarget(imageTarget)
    if (!target) {
      showToast({ type: 'warning', message: '请先在「AI 服务」为供应商开启图片能力并添加生图模型' })
      return
    }
    const key = `${pack.id}:${kind}:${slot}`
    setImageBusyKey(key)
    try {
      await window.moliu.visuals.generateImage({
        packId: pack.id, kind, slot, prompt,
        providerId: target.providerId, model: target.modelId,
        ratio: ratio || (kind === 'cover' ? COVER_RATIO : '1:1'),
        quality: IMAGE_QUALITY,
        resolution: IMAGE_RESOLUTION,
        background: transparent ? 'transparent' : undefined
      })
      await refreshAssets([pack.id])
      showToast({ type: 'success', message: '图片已生成' })
    } catch (error) {
      showToast({ type: 'error', message: `第 ${slot + 1} 张${kind === 'cover' ? '封面' : kind === 'inline' ? '文内图' : '发布图'}生成失败：${errorMessage(error)}` })
    } finally {
      setImageBusyKey('')
    }
  }

  const openImport = (packId: string, kind: VisualAssetKind, slot: number, prompt: string): void => {
    setImportTarget({ packId, kind, slot, prompt })
    fileInputRef.current?.click()
  }

  /** 批量生成整份方案的图片：封面 → 文内 → 发布，自动跳过已有图片的槽位 */
  const generateAllImages = async (pack: VisualPack): Promise<void> => {
    // 批量状态与停止开关是全局单例：跨方案并发会互踩计数与进度，必须串行
    if (batchState) {
      showToast({ type: 'info', message: '已有一个批量任务进行中，请先等它完成或停止' })
      return
    }
    const target = decodeTarget(imageTarget)
    if (!target) {
      showToast({ type: 'warning', message: '请先在「AI 服务」为供应商开启图片能力并添加生图模型' })
      return
    }
    const slots = [
      { kind: 'cover' as const, slot: 0, prompt: pack.cover.prompt, ratio: COVER_RATIO },
      ...pack.inlineImages.map((item, index) => ({ kind: 'inline' as const, slot: index, prompt: item.prompt, ratio: item.ratio })),
      ...pack.releaseImages.map((item, index) => ({ kind: 'release' as const, slot: index, prompt: item.prompt, ratio: item.ratio }))
    ].filter((item) => item.prompt.trim())
    const existing = new Set((assetsByPack[pack.id] ?? []).map((asset) => `${asset.kind}:${asset.slot}`))
    const todo = slots.filter((item) => !existing.has(`${item.kind}:${item.slot}`))
    if (!todo.length) {
      showToast({ type: 'info', message: '这套方案的图片已全部生成' })
      return
    }

    batchStopRef.current = false
    setBatchState({ packId: pack.id, done: 0, total: todo.length, phase: 'generate' })
    // 生图以网络等待为主：2 路并发能把 7 张图从十几分钟压到几分钟
    const queue = [...todo]
    const result = { ok: 0, cancelled: false, failed: [] as string[] }
    const worker = async (): Promise<void> => {
      for (;;) {
        if (batchStopRef.current || result.cancelled) return
        const item = queue.shift()
        if (!item) return
        try {
          await window.moliu.visuals.generateImage({
            packId: pack.id, kind: item.kind, slot: item.slot, prompt: item.prompt,
            providerId: target.providerId, model: target.modelId,
            ratio: item.ratio || (item.kind === 'cover' ? COVER_RATIO : '1:1'),
            quality: IMAGE_QUALITY,
            resolution: IMAGE_RESOLUTION,
            background: transparent ? 'transparent' : undefined
          })
          result.ok += 1
        } catch (error) {
          if (isCancelError(error)) { result.cancelled = true; return }
          result.failed.push(`第 ${item.slot + 1} 张${item.kind === 'cover' ? '封面' : item.kind === 'inline' ? '文内图' : '发布图'}：${errorMessage(error).slice(0, 60)}`)
        } finally {
          setBatchState((current) => current ? { ...current, done: current.done + 1 } : current)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker()))
    await refreshAssets([pack.id])
    setBatchState(null)
    const { ok, cancelled, failed } = result
    const stopped = batchStopRef.current || queue.length > 0
    if (cancelled || stopped) showToast({ type: 'info', message: `批量生成已停止（成功 ${ok} 张${failed.length ? `，失败 ${failed.length} 张` : ''}，未生成 ${todo.length - ok - failed.length} 张）` })
    else if (failed.length) showToast({ type: 'warning', message: `生成完成：成功 ${ok} 张，失败 ${failed.length} 张（${failed[0]}）` })
    else showToast({ type: 'success', message: `全部 ${ok} 张图片已生成` })
  }

  /** 批量上传：把方案内所有未上传的图片资产上传公众号素材库 */
  const uploadAllAssets = async (pack: VisualPack): Promise<void> => {
    if (batchState) {
      showToast({ type: 'info', message: '已有一个批量任务进行中，请先等它完成或停止' })
      return
    }
    const pending = (assetsByPack[pack.id] ?? []).filter((asset) => !asset.wechatMediaId)
    if (!pending.length) {
      showToast({ type: 'info', message: '这套方案的图片都已上传过素材库' })
      return
    }
    batchStopRef.current = false
    setBatchState({ packId: pack.id, done: 0, total: pending.length, phase: 'upload' })
    let ok = 0
    const failed: string[] = []
    for (const asset of pending) {
      if (batchStopRef.current) break
      try {
        await window.moliu.publishing.uploadWechatCover({ assetId: asset.id })
        ok += 1
      } catch (error) {
        failed.push(errorMessage(error).slice(0, 60))
      } finally {
        setBatchState((current) => current ? { ...current, done: current.done + 1 } : current)
      }
    }
    await refreshAssets([pack.id])
    setBatchState(null)
    if (failed.length) showToast({ type: 'warning', message: `上传完成：成功 ${ok} 张，失败 ${failed.length} 张（${failed[0]}）` })
    else showToast({ type: 'success', message: `${ok} 张图片已上传公众号素材库` })
  }

  const handleImportFile = async (file: File): Promise<void> => {
    if (!importTarget) return
    try {
      const data = await file.arrayBuffer()
      await window.moliu.visuals.importImageData({ ...importTarget, fileName: file.name, data })
      await refreshAssets([importTarget.packId])
      showToast({ type: 'success', message: '图片已导入' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setImportTarget(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const uploadAsset = async (packId: string, asset: VisualAsset): Promise<void> => {
    // 复用单图 busy 键防双击重复上传同一张图
    if (imageBusyKey) return
    setImageBusyKey(asset.id)
    try {
      await window.moliu.publishing.uploadWechatCover({ assetId: asset.id })
      await refreshAssets([packId])
      showToast({ type: 'success', message: '已上传到公众号素材库，推送时自动作为封面' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setImageBusyKey('')
    }
  }

  const removeAsset = async (packId: string, asset: VisualAsset): Promise<void> => {
    if (!(await confirm({ title: '删除这张图片？', message: '仅删除本地图片资产，不会影响提示词。', danger: true, confirmLabel: '删除' }))) return
    try {
      await window.moliu.visuals.removeAsset(asset.id)
      await refreshAssets([packId])
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  const removePack = async (pack: VisualPack): Promise<void> => {
    if (!(await confirm({ title: '删除整份配图方案？', message: '方案内的提示词与已生成图片会一并删除。', danger: true, confirmLabel: '删除' }))) return
    try {
      await window.moliu.visuals.remove(pack.id)
      await refresh()
      showToast({ type: 'success', message: '配图方案已删除' })
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    }
  }

  const openEdit = (pack: VisualPack, kind: VisualAssetKind, slot: number, asset: VisualAsset): void => {
    setEditTarget({
      packId: pack.id,
      kind,
      slot,
      prompt: asset.prompt,
      imageUrl: asset.remoteUrl ?? '',
      assetId: asset.remoteUrl ? undefined : asset.id,
      transparent: asset.background === 'transparent'
    })
  }

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      showToast({ type: 'success', message: '提示词已复制' })
    } catch (error) {
      showToast({ type: 'error', message: `复制失败：${errorMessage(error)}` })
    }
  }

  return <div className="page visuals-page">
    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportFile(file) }} />
    <PageHeader
      route="visuals"
      onNavigate={onNavigate}
      title="智能配图"
      description="可直接导入自己的封面与正文图，也可选用 AI 生成配图方案"
      actions={articleId && <div className="page-intro-actions">
        <button className="button secondary" onClick={() => setImportOpen(true)}><FileUp size={16} />导入方案</button>
        <button className="button secondary" onClick={() => onNavigate('layouts', { articleId })}><LayoutTemplate size={16} />去排版</button>
      </div>}
    />
    {selectionError && <p className="inline-alert" role="alert">{selectionError}</p>}
    <SavedVersionGate article={selected} onSaved={refresh} onNavigate={onNavigate} />

    <div className="studio-actions" style={{marginBottom:20}}><button className={studioMode ? 'button primary' : 'button secondary'} onClick={() => setStudioMode(true)}>内容配图工作台</button><button className={!studioMode ? 'button primary' : 'button secondary'} onClick={() => setStudioMode(false)}>原有方案与图片</button></div>
    {studioMode ? <VisualStudio article={selected ?? null} articleId={articleId} importedPlanId={importedPlanId} onArticleChange={setArticleId} providers={providers} onApplied={refresh} /> : !articles.length ? (
      <EmptyState
        icon={ImageIcon}
        title="还没有可配图的文章"
        description="先在「文章创作」中完成一篇文章，这里会为它设计封面与配图方案。"
        actionLabel="去写文章"
        onAction={() => onNavigate('articles')}
      />
    ) : (
      <div className="visual-studio">
        <section className="visual-composer">
          <button className="button secondary" disabled={!articleId} onClick={() => void (async () => {
            await window.moliu.visuals.createManualPack(articleId)
            await refresh()
            showToast({ type: 'success', message: '本地图片集合已就绪，可直接导入封面和正文图片' })
          })().catch(error => showToast({ type: 'error', message: errorMessage(error) }))}><ImagePlus size={16} />直接导入自己的图片</button>
          <label className="field"><span>文章</span>
            <ArticlePicker value={articleId} onChange={setArticleId} />
          </label>
          <label className="field"><span>方案模型</span>
            <Select value={modelTarget} onChange={setModelTarget} ariaLabel="方案模型" options={availableModels(providers).map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))} />
          </label>
          <label className="field"><span>生图模型</span>
            <Select value={imageTarget} onChange={setImageTarget} ariaLabel="生图模型" placeholder={imageModels.length ? '选择生图模型' : '无可用生图模型'} options={imageModels.map(({ provider, model }) => ({ value: encodeModelTarget(provider.id, model.modelId), label: model.displayName, hint: provider.displayName }))} />
          </label>
          <label className="field"><span>文内图</span>
            <Select value={String(count)} onChange={(value) => setCount(Number(value))} ariaLabel="文内图数量" options={[2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} 张` }))} />
          </label>
          <label className="switch-row" title="生成带透明通道的 PNG，适合贴纸、图标类素材">
            <input
              type="checkbox"
              name="transparentBackground"
              autoComplete="off"
              checked={transparent}
              onChange={(event) => setTransparent(event.target.checked)}
            />
            <span><strong>透明背景</strong></span>
          </label>
          {stream.active ? (
            <button className="button danger" onClick={stream.cancel}><X size={16} />取消</button>
          ) : (
            <button
              className="button primary"
              disabled={!articleId || !modelTarget || needsSavedVersion}
              onClick={() => void generatePlan()}
              title={!articleId ? '请先选择要配图的文章' : '请先选择方案模型'}
            >
              <Sparkles size={16} />生成方案
            </button>
          )}
          {/* 禁用原因就近说明，避免用户猜测按钮为何点不动 */}
          {!articleId && (
            <p className="form-hint" role="note">请先在上方选择要配图的文章</p>
          )}
          {articleId && !modelTarget && (
            <p className="form-hint" role="note">请先在上方选择一个方案模型</p>
          )}
        </section>

        <div className="visual-output">
        {!imageModels.length && (
          <p className="inline-alert"><Palette size={16} />尚未配置生图模型：在「AI 服务」中为供应商勾选「图片生成」能力并添加生图模型后，即可一键出图；也可以逐张导入本地图片。</p>
        )}

        {stream.active && <StreamingPreview progress={stream.progress} content={stream.content} label="正在设计配图方案…" />}

        {selected?.status === 'draft' && <p className="visual-warning">当前文章为草稿版本，锁定后配图会绑定固定版本。</p>}

        {currentPacks.length > 0 && (
          <NextStepBar text="封面图就绪后即可排版并推送草稿箱。" actionLabel="去排版" onAction={() => onNavigate('layouts', { articleId })} />
        )}

        <section className="visual-results">
          {currentPacks.length ? currentPacks.map((pack) => (
            <VisualPackCard
              key={pack.id}
              pack={pack}
              articleTitle={selected ? markdownTitle(selected.rawMarkdown) : '文章'}
              assets={assetsByPack[pack.id] ?? []}
              imageBusyKey={imageBusyKey}
              imageModelReady={Boolean(imageTarget)}
              batch={batchState?.packId === pack.id ? batchState : null}
              anyBatch={Boolean(batchState)}
              onCopy={copy}
              onGenerateImage={generateImage}
              onEditAsset={openEdit}
              onGenerateAll={() => void generateAllImages(pack)}
              onUploadAll={() => void uploadAllAssets(pack)}
              onStopBatch={() => { batchStopRef.current = true; void window.moliu.generation.cancel('visuals') }}
              onImport={openImport}
              onUploadAsset={uploadAsset}
              onRemoveAsset={removeAsset}
              onRemove={() => void removePack(pack)}
            />
          )) : !stream.active && (
            <EmptyState
              icon={ImageIcon}
              title="暂无配图方案"
              description="点击「生成方案」，AI 会为这篇文章设计 1 张封面、若干文内配图与发布配图。"
            />
          )}
        </section>
        </div>
      </div>
    )}
    {ConfirmPortal}
    {editTarget && (
      <EditImageDialog
        target={editTarget}
        imageTarget={imageTarget}
        onClose={() => setEditTarget(null)}
        onDone={async (packId) => {
          setEditTarget(null)
          await refreshAssets([packId])
          showToast({ type: 'success', message: '改图完成' })
        }}
      />
    )}
    <ImportDialog
      open={importOpen}
      kind="visual-plan"
      associations={{ articleId, visualStudio: studioMode }}
      onClose={() => setImportOpen(false)}
      onImported={(result) => { if (studioMode && result.created[0]) setImportedPlanId(result.created[0].id); void refresh() }}
      showToast={showToast}
    />
  </div>
}

interface VisualPackCardProps {
  pack: VisualPack
  articleTitle: string
  assets: VisualAsset[]
  imageBusyKey: string
  imageModelReady: boolean
  batch: { done: number; total: number; phase: 'generate' | 'upload' } | null
  /** 页面级：任意批量进行中（单图生成与批量共用取消域，需暂停单图入口） */
  anyBatch: boolean
  onCopy(text: string): Promise<void>
  onGenerateImage(pack: VisualPack, kind: VisualAssetKind, slot: number, prompt: string, ratio?: string): Promise<void>
  onEditAsset(pack: VisualPack, kind: VisualAssetKind, slot: number, asset: VisualAsset): void
  onGenerateAll(): void
  onUploadAll(): void
  onStopBatch(): void
  onImport(packId: string, kind: VisualAssetKind, slot: number, prompt: string): void
  onUploadAsset(packId: string, asset: VisualAsset): Promise<void>
  onRemoveAsset(packId: string, asset: VisualAsset): Promise<void>
  onRemove(): void
}

function VisualPackCard({ pack, articleTitle, assets, imageBusyKey, imageModelReady, batch, anyBatch, onCopy, onGenerateImage, onEditAsset, onGenerateAll, onUploadAll, onStopBatch, onImport, onUploadAsset, onRemoveAsset, onRemove }: VisualPackCardProps): React.JSX.Element {
  const assetsFor = (kind: VisualAssetKind, slot: number): VisualAsset[] =>
    assets.filter((asset) => asset.kind === kind && asset.slot === slot)

  return (
    <article className="visual-pack">
      <header className="visual-pack-head">
        <div>
          <h3>{articleTitle} <SourceBadge source={pack.importSource} /></h3>
          <p>{pack.model} · {formatDate(pack.createdAt)} · {pack.inlineImages.length} 张文内图 + {pack.releaseImages.length} 张发布图</p>
        </div>
        <div className="visual-pack-actions">
          {batch ? (
            <>
              <span className="badge primary">
                批量{batch.phase === 'generate' ? '生成' : '上传'}中 {batch.done}/{batch.total}
              </span>
              <button className="button danger compact" onClick={onStopBatch}><X size={16} />停止</button>
            </>
          ) : (
            <>
              <button className="button secondary compact" disabled={!imageModelReady} onClick={onGenerateAll} title="按封面→文内→发布顺序生成全部图片（已生成的自动跳过）">
                <Sparkles size={16} />生成全部图片
              </button>
              <button className="button secondary compact" disabled={!assets.some((asset) => !asset.wechatMediaId)} onClick={onUploadAll} title="把未上传的图片批量上传公众号素材库">
                <UploadCloud size={16} />全部上传
              </button>
            </>
          )}
          <button className="icon-button danger" title="删除方案" aria-label="删除方案" onClick={onRemove}><Trash2 size={16} /></button>
        </div>
      </header>

      <section className="visual-cover">
        <div className="visual-cover-info">
          <h4>封面</h4>
          <em>比例：{COVER_RATIO}</em>
          <strong>{pack.cover.visual}</strong>
          <em>封面文案：{pack.cover.overlayText || '—'}</em>
        </div>
        <VisualSlot
          pack={pack} kind="cover" slot={0} prompt={pack.cover.prompt} ratio={COVER_RATIO} assets={assetsFor('cover', 0)}
          imageBusyKey={imageBusyKey} batchActive={anyBatch || Boolean(batch)} onCopy={onCopy} onGenerateImage={onGenerateImage} onEditAsset={onEditAsset} onImport={onImport} onUploadAsset={onUploadAsset} onRemoveAsset={onRemoveAsset}
        />
      </section>

      <PromptGroup title="文内配图" items={pack.inlineImages} kind="inline" />
      <PromptGroup title="发布配图" items={pack.releaseImages} kind="release" />
    </article>
  )

  function PromptGroup({ title, items, kind }: { title: string; items: VisualPrompt[]; kind: 'inline' | 'release' }): React.JSX.Element {
    return (
      <section className="visual-prompt-group">
        <h4>{title}</h4>
        {items.map((item, index) => (
          <div className="visual-prompt" key={`${kind}-${index}`}>
            <header>
              <strong>{item.location || `${title} ${index + 1}`}</strong>
              <span>{item.ratio} · {item.purpose}</span>
            </header>
            <VisualSlot
              pack={pack} kind={kind} slot={index} prompt={item.prompt} ratio={item.ratio} assets={assetsFor(kind, index)}
              imageBusyKey={imageBusyKey} batchActive={anyBatch || Boolean(batch)} onCopy={onCopy} onGenerateImage={onGenerateImage} onEditAsset={onEditAsset} onImport={onImport} onUploadAsset={onUploadAsset} onRemoveAsset={onRemoveAsset}
            />
            {item.alt && <small>替代文本：{item.alt}</small>}
          </div>
        ))}
      </section>
    )
  }
}

interface VisualSlotProps {
  pack: VisualPack
  kind: VisualAssetKind
  slot: number
  prompt: string
  /** 该槽位的目标比例；封面固定 21:9，文内/发布图用方案里的比例 */
  ratio?: string
  assets: VisualAsset[]
  imageBusyKey: string
  /** 批量任务进行中：单图生成与批量共用同一个取消域，暂停单图入口避免被「停止批量」连带取消 */
  batchActive?: boolean
  onCopy(text: string): Promise<void>
  onGenerateImage(pack: VisualPack, kind: VisualAssetKind, slot: number, prompt: string, ratio?: string): Promise<void>
  onEditAsset(pack: VisualPack, kind: VisualAssetKind, slot: number, asset: VisualAsset): void
  onImport(packId: string, kind: VisualAssetKind, slot: number, prompt: string): void
  onUploadAsset(packId: string, asset: VisualAsset): Promise<void>
  onRemoveAsset(packId: string, asset: VisualAsset): Promise<void>
}

function VisualSlot({ pack, kind, slot, prompt, ratio, assets, imageBusyKey, batchActive, onCopy, onGenerateImage, onEditAsset, onImport, onUploadAsset, onRemoveAsset }: VisualSlotProps): React.JSX.Element {
  const busy = imageBusyKey === `${pack.id}:${kind}:${slot}`
  return (
    <div className="visual-slot">
      <div className="visual-prompt-text">
        <p>{prompt}</p>
        <div className="visual-slot-actions">
          <button className="button ghost tiny" onClick={() => void onCopy(prompt)}><Copy size={16} />复制提示词</button>
          <button className="button secondary tiny" disabled={busy || batchActive || !prompt} title={batchActive ? '批量任务进行中，请先完成或停止' : undefined} onClick={() => void onGenerateImage(pack, kind, slot, prompt, ratio)}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{busy ? '生成中…' : '生成图片'}
          </button>
          <button className="button ghost tiny" onClick={() => onImport(pack.id, kind, slot, prompt)}><ImagePlus size={16} />导入本地</button>
        </div>
      </div>
      {assets.length > 0 && (
        <div className="visual-asset-grid">
          {assets.map((asset) => (
            <figure className="visual-asset" key={asset.id}>
              <img src={asset.url} alt={asset.prompt.slice(0, 40)} loading="lazy" />
              <figcaption>
                <span className={`badge ${asset.source === 'generated' ? 'primary' : 'neutral'}`}>{asset.source === 'generated' ? 'AI 生成' : '本地导入'}</span>
                {asset.size && <span className="badge neutral">{asset.size}</span>}
                {asset.costUsd !== undefined && <span className="badge neutral">{asset.costEstimated ? '≈' : ''}${asset.costUsd.toFixed(4)}</span>}
                {asset.remoteUrl ? (
                  <button className="button ghost tiny" disabled={Boolean(imageBusyKey)} onClick={() => onEditAsset(pack, kind, slot, asset)} title="用这张图做参考，按修改提示词重新生成">
                    <Sparkles size={16} />改这张图
                  </button>
                ) : (
                  <button className="button ghost tiny" disabled={Boolean(imageBusyKey)} onClick={() => onEditAsset(pack, kind, slot, asset)} title="先自动上传这张图，再按修改提示词重新生成">
                    <Sparkles size={16} />改这张图
                  </button>
                )}
                {asset.wechatMediaId
                  ? <span className="badge success"><UploadCloud size={16} />已上传素材库</span>
                  : <button className="button secondary tiny" disabled={Boolean(imageBusyKey)} onClick={() => void onUploadAsset(pack.id, asset)}><UploadCloud size={16} />上传公众号</button>}
                <button className="icon-button danger" title="删除图片" aria-label="删除图片" onClick={() => void onRemoveAsset(pack.id, asset)}><Trash2 size={16} /></button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

function EditImageDialog({ target, imageTarget, onClose, onDone }: {
  target: { packId: string; kind: VisualAssetKind; slot: number; prompt: string; imageUrl: string; assetId?: string; transparent?: boolean }
  imageTarget: string
  onClose(): void
  onDone(packId: string): Promise<void>
}): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState(target.imageUrl)
  const [ratio, setRatio] = useState('1:1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    const decoded = decodeTarget(imageTarget)
    if (!decoded) { setError('请先在配图页选择生图模型'); return }
    if (!prompt.trim()) { setError('请填写修改提示词'); return }
    const url = imageUrl.trim()
    if (!url && !target.assetId) { setError('请填写参考图地址'); return }
    if (url && !/^https?:\/\//i.test(url)) { setError('参考图必须是 http(s) 地址'); return }
    setBusy(true)
    setError('')
    try {
      await window.moliu.visuals.editImage({
        packId: target.packId,
        kind: target.kind,
        slot: target.slot,
        prompt: prompt.trim(),
        providerId: decoded.providerId,
        model: decoded.modelId,
        ...(url ? { imageUrl: url } : { assetId: target.assetId }),
        ratio,
        quality: 'low'
      })
      await onDone(target.packId)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalBase open onClose={onClose} titleId="edit-image-title" className="edit-image-dialog">
      <header>
        <div>
          <h2 id="edit-image-title">参考图编辑</h2>
          <p>保留主体、按提示词修改。参考图必须是供应商能访问的 http(s) 地址。</p>
        </div>
        <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20} /></button>
      </header>
      {target.transparent && (
        <p className="inline-alert">这张图是透明背景，供应商可能拒绝把它当参考图（实测会失败）。建议先生成一张不透明图再改，或换一个参考图地址。</p>
      )}
      <label className="field">
        <span>参考图地址{target.assetId ? '（留空则自动上传当前图片）' : ''}</span>
        <input type="url" name="editImageUrl" autoComplete="off" spellCheck={false} value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder={target.assetId ? '留空：自动上传这张本地图片' : 'https://…'} />
      </label>
      <label className="field">
        <span>修改提示词</span>
        <textarea name="editPrompt" rows={4} autoComplete="off" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把背景换成夜晚的城市，保留主体和构图" />
      </label>
      <label className="field">
        <span>输出比例</span>
        <Select value={ratio} onChange={setRatio} ariaLabel="改图比例" options={[
          { value: '1:1', label: '1:1' },
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
          { value: '4:3', label: '4:3' },
          { value: '3:2', label: '3:2' },
          { value: '21:9', label: '21:9' }
        ]} />
      </label>
      {error && <p className="inline-alert danger" role="alert">{error}</p>}
      <footer>
        <button className="button ghost" disabled={busy} onClick={onClose}>取消</button>
        <button className="button primary" disabled={busy} onClick={() => void submit()}>{busy ? '改图中…' : '开始改图'}</button>
      </footer>
    </ModalBase>
  )
}

function decodeTarget(value: string): { providerId: string; modelId: string } | null {
  try {
    const [providerId, modelId] = JSON.parse(value) as unknown[]
    return typeof providerId === 'string' && typeof modelId === 'string' ? { providerId, modelId } : null
  } catch {
    return null
  }
}
