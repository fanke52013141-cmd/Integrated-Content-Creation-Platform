import { useEffect, useRef, useState } from 'react'
import type { Article, ProviderSummary, VisualAsset, ImageQuality, ImageResolution } from '../../../shared/contracts'
import type { ApplyVisualPreview, PictureBrief, VisualModelTarget, VisualPlan, VisualStyle, VisualStyleInput, VisualImageJob, VisualAssetState, VisualPlanDraft, StyleSampleTask } from '../../../shared/visual-studio'
import { articleBlocks, pictureSignature } from '../../../shared/visual-studio'
import { ArticlePicker } from './ArticlePicker'
import { ModalBase } from './ModalBase'
import { Select } from './Select'
import { useConfirm } from './useConfirm'
import { availableModels, decodeModelTarget, encodeModelTarget, useModelTarget, DEFAULT_IMAGE_MODEL_KEY } from '../lib/models'
import { errorMessage, sanitizeHtml } from '../lib'
import '../styles/visual-studio.css'

const api = () => window.moliu.visuals.studio
const newStyle = (): VisualStyleInput => ({ name: '', description: '', colors: '', medium: '', composition: '', avoid: '随机文字、水印、杂乱背景', references: [] })
const label = { cover: '公众号封面', header: '正文顶部图', inline: '正文配图', release: '发布图' }
// 批量生图的费用确认只在会话内可被跳过：应用重启后重新确认，避免静默扣费成为默认
let batchCostConfirmSuppressed = false
function target(value: string): VisualModelTarget {
  const decoded = decodeModelTarget(value)
  if (!decoded) throw new Error('请先选择模型')
  return { providerId: decoded.providerId, model: decoded.modelId }
}

export function VisualStudio({ article, articleId, importedPlanId, onArticleChange, providers, onApplied }: {
  article: Article | null; articleId: string; onArticleChange(id: string): void
  importedPlanId?: string
  providers: ProviderSummary[]; onApplied(): Promise<void>
}): React.JSX.Element {
  const { confirm, ConfirmPortal } = useConfirm()
  const [styles, setStyles] = useState<VisualStyle[]>([]), [plans, setPlans] = useState<VisualPlan[]>([])
  const [plan, setPlan] = useState<VisualPlan | null>(null), [dirty, setDirty] = useState(false)
  const [assets, setAssets] = useState<VisualAsset[]>([])
  const [styleEdit, setStyleEdit] = useState<VisualStyleInput | null>(null)
  const [styleDirty, setStyleDirty] = useState(false), [defaultId, setDefaultId] = useState('')
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [count, setCount] = useState('auto'), [density, setDensity] = useState<'minimal'|'standard'|'rich'>('standard')
  const [cover, setCover] = useState(true), [header, setHeader] = useState(true)
  const [referenceMode, setReferenceMode] = useState<'image'|'text'>('image')
  const [preview, setPreview] = useState<ApplyVisualPreview | null>(null), [previewHtml, setPreviewHtml] = useState('')
  const [lastAppliedVersion, setLastAppliedVersion] = useState('')
  const [samples,setSamples]=useState<StyleSampleTask[]>([])
  const [history, setHistory] = useState<VisualStyle[]>([])
  const [jobs,setJobs] = useState<VisualImageJob[]>([]), [assetStates,setAssetStates] = useState<VisualAssetState[]>([])
  const [quality,setQuality] = useState<ImageQuality>('low'), [resolution,setResolution] = useState<ImageResolution>('1k')
  const [stage,setStage] = useState<'plan'|'style'|'images'|'apply'>('plan')
  const [draftStatus,setDraftStatus] = useState(''), [conflictDraft,setConflictDraft] = useState<VisualPlanDraft | null>(null)
  const draftVersions = useRef(new Map<string,number>()), draftChain = useRef<Promise<void>>(Promise.resolve())
  const pendingEdit = useRef<VisualPlan | null>(null), draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewPlanId=useRef('')
  const stop = useRef(false), loadSequence = useRef(0), operationActive = useRef(false)
  const lastRun = useRef<{ name: string; action: () => Promise<void> } | null>(null)
  const textModels = availableModels(providers)
  const imageModels = providers.filter(p => p.enabled && p.hasApiKey && p.capabilities.image).flatMap(provider => provider.models.filter(m => m.enabled).map(model => ({ provider, model })))
  const [textTarget, setTextTarget] = useModelTarget(textModels, undefined, 'visual-studio.plan')
  const [promptTarget, setPromptTarget] = useModelTarget(textModels, 'moliu:visual-prompt-model', 'visual-studio.prompts')
  const [imageTarget, setImageTarget] = useModelTarget(imageModels, DEFAULT_IMAGE_MODEL_KEY)
  const run = async (name: string, action: () => Promise<void>): Promise<void> => {
    if (operationActive.current) return
    operationActive.current = true
    setBusy(name); setError(''); setNotice('')
    try {
      await action()
      lastRun.current = null
    } catch (e) {
      // 记住失败的操作，错误提示旁提供一键重试，用户不必找回原按钮
      lastRun.current = { name, action }
      setError(errorMessage(e))
    } finally { setBusy(''); operationActive.current = false }
  }
  const persistDraft = (snapshot: VisualPlan) => {
    draftChain.current = draftChain.current.catch(()=>undefined).then(async()=>{
      const saved = await api().saveDraft({plan:snapshot,expectedRevision:draftVersions.current.get(snapshot.id) ?? 0})
      draftVersions.current.set(snapshot.id,saved.revision)
      setDraftStatus('编辑已自动暂存到本机，可在重启后恢复')
    }).catch(e=>{setDraftStatus(`自动暂存失败：${errorMessage(e)}；请保留当前窗口并检查草稿差异`);throw e})
    void draftChain.current.catch(()=>undefined)
    return draftChain.current
  }
  const refreshProgress = async (id: string) => {
    const [nextAssets,nextJobs,nextStates] = await Promise.all([window.moliu.visuals.listAssets(id),api().jobs(id),api().assetStates(id)])
    if(viewPlanId.current!==id)return
    setAssets(nextAssets);setJobs(nextJobs);setAssetStates(nextStates)
  }
  const reload = async (keepId?: string): Promise<void> => {
    const sequence = ++loadSequence.current
    const [nextStyles, nextPlans, defaultStyle] = await Promise.all([api().styles(), articleId ? api().plans(articleId) : [], article?.accountId ? api().defaultStyle(article.accountId) : null])
    if (sequence !== loadSequence.current) return
    setStyles(nextStyles); setPlans(nextPlans); setDefaultId(defaultStyle?.id ?? '')
    let cached: VisualPlan | null = null
    try { cached = JSON.parse(sessionStorage.getItem(`visual-studio-draft:${articleId}`) ?? 'null') } catch { /* storage unavailable */ }
    let current: VisualPlan | null = nextPlans.find(p => p.id === (keepId ?? cached?.id)) ?? nextPlans[0] ?? null
    const serverDraft = current ? await api().getDraft(current.id) : null
    if (sequence !== loadSequence.current) return
    if (serverDraft) draftVersions.current.set(serverDraft.planId,serverDraft.revision)
    if (serverDraft?.plan && serverDraft.baseRevision === current?.revision) cached = serverDraft.plan
    setConflictDraft(serverDraft?.plan && serverDraft.baseRevision !== current?.revision ? serverDraft : null)
    const recovered = Boolean(current && cached && cached.id === current.id && cached.revision === current.revision)
    if (recovered) { current = cached; setNotice('已恢复本地未保存的方案修改，请保存后继续') }
    else if (cached) setNotice('本地编辑对应的方案已更新，请重新检查方案；旧编辑仍保留在当前会话缓存中')
    viewPlanId.current=current?.id??''
    setPlan(current); setDirty(recovered); setPreview(null)
    if (current) await refreshProgress(current.id)
    else { setAssets([]);setJobs([]);setAssetStates([]) }
  }
  useEffect(() => { void reload().catch(e => setError(errorMessage(e))); return () => { loadSequence.current++ } }, [articleId, article?.accountId])
  useEffect(()=>{
    if (!plan) return
    let alive=true
    const timer=setInterval(()=>{ if(alive) void refreshProgress(plan.id).catch(e=>setError(errorMessage(e))) },1000)
    return()=>{alive=false;clearInterval(timer)}
  },[plan?.id])
  useEffect(()=>()=>{if(draftTimer.current)clearTimeout(draftTimer.current);if(pendingEdit.current)void persistDraft(pendingEdit.current).catch(()=>undefined)},[])
  useEffect(()=>{if(!styleEdit)return;let alive=true;const load=()=>void api().samples().then(s=>{if(alive)setSamples(s)}).catch(e=>{if(alive)setError(errorMessage(e))});load();const timer=setInterval(load,1000);return()=>{alive=false;clearInterval(timer)}},[Boolean(styleEdit)])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty || styleDirty) event.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, styleDirty])
  const canDiscard = async () => {
    if (!dirty) return true
    const accepted = await confirm({ title: '放弃未保存的方案修改？', message: '保存方案后可继续生成图片。', confirmLabel: '放弃修改' })
    if (accepted) {
      if(draftTimer.current)clearTimeout(draftTimer.current);pendingEdit.current=null
      await draftChain.current.catch(()=>undefined)
      const saved=plan ? await api().getDraft(plan.id) : null
      if(saved?.plan){await api().discardDraft(saved.planId,saved.revision);draftVersions.current.set(saved.planId,saved.revision+1)}
      try { sessionStorage.removeItem(`visual-studio-draft:${articleId}`) } catch { /* storage unavailable */ }
    }
    return accepted
  }
  const change = (next: VisualPlan) => {
    setPlan(next); setDirty(true); setPreview(null)
    pendingEdit.current=next
    if(draftTimer.current)clearTimeout(draftTimer.current)
    setDraftStatus('正在自动暂存…')
    draftTimer.current=setTimeout(()=>{const snapshot=pendingEdit.current;if(snapshot)void persistDraft(snapshot).catch(()=>undefined)},400)
    try { sessionStorage.setItem(`visual-studio-draft:${articleId}`, JSON.stringify(next)) } catch { setNotice('本地缓存不可用，请保存方案后再离开') }
  }
  useEffect(() => {
    if (!importedPlanId) return
    void run('载入外部方案', async () => {
      setPlans(await api().plans(articleId))
      if (await canDiscard()) { await reload(importedPlanId); setStage('plan') }
      else setNotice('外部方案已保存，可在方案列表中切换；当前编辑已保留')
    })
  }, [importedPlanId])
  const editPicture = (id: string, patch: Partial<PictureBrief>) => { if (plan) change({ ...plan, pictures: plan.pictures.map(p => p.id === id ? { ...p, ...patch } : p) }) }
  const save = async () => {
    if(!plan)return
    if(draftTimer.current)clearTimeout(draftTimer.current)
    await draftChain.current.catch(()=>undefined)
    await persistDraft(plan)
    const saved=await api().savePlan(plan,draftVersions.current.get(plan.id))
    const cleared=await api().getDraft(plan.id);if(cleared)draftVersions.current.set(plan.id,cleared.revision)
    pendingEdit.current=null;setPlan(saved);setPlans(list=>list.map(p=>p.id===saved.id?saved:p));setDirty(false);setConflictDraft(null);setDraftStatus('方案已保存')
    try{sessionStorage.removeItem(`visual-studio-draft:${articleId}`)}catch{/* optional cache */}
    setNotice('方案已保存');await refreshProgress(saved.id)
  }
  const generateOne = async (picture: PictureBrief) => {
    if (!plan) return
    const effectiveStyle = picture.style ?? plan.style
    const mode = effectiveStyle?.references.length ? referenceMode : 'text'
    await api().enqueue({ ...target(imageTarget), planId: plan.id, pictureId: picture.id, expectedRevision: plan.revision, referenceMode: mode,quality,resolution })
    await refreshProgress(plan.id)
    setNotice('已加入后台生成队列，可离开页面；完成后选择候选图')
  }
  const generateBatch = async () => {
    if (!plan) return
    const model = target(imageTarget)
    const todo = plan.pictures.filter(p => !(p.promptStale ?? plan.promptsStale) && !assets.some(a => a.slot === p.slot && a.kind === (p.kind === 'header' ? 'inline' : p.kind) && (assetStates.find(s=>s.assetId===a.id)?.status==='current' || a.source==='imported' && p.selectedAssetId===a.id)))
    if (!todo.length) { setNotice(plan.pictures.some(p=>p.promptStale??plan.promptsStale)?'部分图片需要先更新提示词，再更新图片':'每个图片项已有符合当前方案的候选图，可单独重新生成'); return }
    const price = imageModels.find(m => m.provider.id === model.providerId && m.model.modelId === model.model)?.model.pricePerImage
    if (!batchCostConfirmSuppressed && !(await confirm({
      title: `生成 ${todo.length} 张图片？`,
      message: price !== undefined ? `按模型配置估算约 $${(price * todo.length).toFixed(3)}，实际费用以供应商账单为准。等待时间因供应商而异。` : '当前模型未配置单张价格，无法估算费用；等待时间因供应商而异。生成后逐张选择采用。',
      confirmLabel: '开始生成',
      suppressLabel: '本次会话不再提示（重启应用后会再次确认）',
      onSuppress: () => { batchCostConfirmSuppressed = true }
    }))) return
    stop.current = false
    const failed: string[] = []
    let done = 0
    for (const picture of todo) {
      if (stop.current) break
      setBusy(`生成 ${++done}/${todo.length}`)
      try { await generateOne(picture) } catch (e) { failed.push(`${picture.subject}：${errorMessage(e)}`) }
    }
    await refreshProgress(plan.id)
    setNotice(`已将 ${done}/${todo.length} 张加入后台队列${stop.current ? '，已停止添加' : ''}`)
    if (failed.length) setError(failed.join('；'))
  }
  const closeStyle = async () => {
    if (styleDirty && !(await confirm({ title: '放弃未保存的风格？', message: '保存后可跨文章复用。', confirmLabel: '放弃修改' }))) return
    setStyleEdit(null); setStyleDirty(false)
  }
  const updateStyle = (patch: Partial<VisualStyleInput>) => { if (styleEdit) { setStyleEdit({ ...styleEdit, ...patch }); setStyleDirty(true) } }
  const blocks = articleBlocks(article?.rawMarkdown ?? '')
  const unavailable = Boolean(busy || dirty)
  const selectedImageModel = imageModels.find(m => encodeModelTarget(m.provider.id, m.model.modelId) === imageTarget)?.model
  return <section className="visual-studio-workflow" data-stage={stage} aria-label="内容配图工作台">
    <div className="studio-step-title"><strong>内容方案 → 风格与提示词 → 图片 → 应用文章</strong><button className="button secondary compact" disabled={Boolean(busy)} onClick={() => { setStyleEdit(newStyle()); setHistory([]); setStyleDirty(false) }}>创建配图风格</button></div>
    <nav className="studio-stages" aria-label="配图流程步骤">{([['plan','1. 确认内容方案'],['style','2. 风格与提示词'],['images','3. 生成与选图'],['apply','4. 应用文章']] as const).map(([id,title])=><button className={stage===id?'button primary':'button secondary'} disabled={(id==='images'||id==='apply')&&!plan} aria-current={stage===id?'step':undefined} key={id} onClick={()=>setStage(id)}>{title}</button>)}</nav>
    {dirty&&<div className="studio-actions"><span role="status">{draftStatus}</span><button className="button secondary" disabled={Boolean(busy)} onClick={()=>void run('保存方案',save)}>保存方案修改</button></div>}
    {conflictDraft?.plan&&<details className="studio-draft-conflict"><summary>发现旧版本草稿，查看与当前方案的差异</summary><div className="studio-diff"><pre>当前方案：{JSON.stringify(plan?.pictures.map(p=>({内容:p.subject,提示词:p.prompt})),null,2)}</pre><pre>保留的草稿：{JSON.stringify(conflictDraft.plan.pictures.map(p=>({内容:p.subject,提示词:p.prompt})),null,2)}</pre></div><button className="button secondary" onClick={()=>{if(plan&&conflictDraft.plan){const original=conflictDraft.plan;let nextSlot=plan.nextSlot;change({...plan,style:original.style,pictures:original.pictures.map(p=>{const current=plan.pictures.find(i=>i.id===p.id);return {...p,slot:current?.slot??(p.kind==='cover'?0:nextSlot++),selectedAssetId:current?.selectedAssetId,approvedAssetSignature:current?.approvedAssetSignature}})});setConflictDraft(null)}}}>将草稿内容载入当前方案检查</button></details>}
    {error && <p className="inline-alert" role="alert">{error}{lastRun.current && !busy && <button className="text-button" onClick={() => { const last = lastRun.current; if (last) void run(last.name, last.action) }}>重试「{lastRun.current.name}」</button>}</p>}{notice && <p role="status" className="form-hint">{notice}</p>}
    {plan&&<div className="studio-generation-options studio-image-section">
      <label className="field"><span>出图质量</span><select aria-label="出图质量" value={quality} onChange={e=>setQuality(e.target.value as ImageQuality)}><option value="low">低 · 快速样图</option><option value="medium">中 · 正文配图</option><option value="high">高 · 封面精修</option></select></label>
      <label className="field"><span>分辨率</span><select aria-label="生图分辨率" value={resolution} onChange={e=>setResolution(e.target.value as ImageResolution)}>{['1k','2k','4k'].map(r=><option value={r} key={r}>{r.toUpperCase()}</option>)}</select></label>
      <p className="form-hint">单张预计费用：{selectedImageModel?.pricePerImage !== undefined ? `$${selectedImageModel.pricePerImage.toFixed(3)}（按模型配置估算）` : '未知（模型未配置价格）'}；等待时间因供应商而异。质量、分辨率和参考图可能影响实际费用，以供应商账单为准。</p>
      <p className="form-hint">模型需支持所选质量、尺寸与参考图上传／编辑接口。不支持时会显示错误；可显式选择仅文字模式。</p>
      <p>本方案已记录图片费用：${assets.reduce((sum,a)=>sum+(a.costUsd??0),0).toFixed(3)}{assets.some(a=>a.costEstimated)?'（含估算）':''}；{assets.filter(a=>a.source==='generated'&&a.costUsd===undefined).length} 张费用未知。</p>
    </div>}
    {jobs.length>0&&<details className="studio-jobs" open><summary>后台配图任务 · {jobs.filter(j=>j.status==='completed').length}/{jobs.length} 已完成</summary><p className="form-hint">切换页面后任务继续执行。重启会续查已提交任务；结果不明时先核对供应商后台，避免重复扣费。</p>{jobs.slice(-20).map(job=><div className="studio-job" key={job.id}><span>{plan?.pictures.find(p=>p.id===job.pictureId)?.subject??'已移除图片项'} · {{queued:'排队中',running:'生成中',recovering:'续查中',completed:'已完成',failed:'失败',paused:'已暂停',unknown:'结果待核对'}[job.status]}{job.error&&<small>{job.error}</small>}</span><div className="studio-actions">{(['queued','running','recovering'].includes(job.status)?['pause']:job.status==='paused'?['resume']:job.status==='failed'?['retry']:job.status==='unknown'?job.remoteTaskId?['check-result','confirm-not-submitted']:['confirm-not-submitted']:[]).map(action=><button className="button ghost compact" key={action} onClick={()=>void run('更新任务',async()=>{if(action==='confirm-not-submitted'&&!(await confirm({title:'已确认供应商没有可用生成结果？',message:'只有核对供应商后台，确认此次结果不可用后才重新提交。再次提交可能产生费用。',confirmLabel:'已核对，重新提交'})))return;await api().controlJob({id:job.id,action:action as 'pause'|'resume'|'retry'|'check-result'|'confirm-not-submitted'});if(plan)await refreshProgress(plan.id)})}>{{pause:'暂停',resume:'继续／续查',retry:'重试失败任务','check-result':'再查一次（不重新生图）','confirm-not-submitted':'核对后重试'}[action]}</button>)}</div></div>)}</details>}
    <fieldset disabled={Boolean(busy)} className="studio-controls studio-content-controls">
      <div className="studio-wide studio-quick-start"><strong>快速开始</strong><p className="form-hint">选择文章和方案模型，使用推荐数量与标准密度生成方案；生成后仍可逐张调整。此步骤不生成图片。</p><button type="button" className="button secondary compact" onClick={() => { setCount('auto'); setDensity('standard'); setCover(true); setHeader(true); setNotice('已应用推荐设置，请确认文章与方案模型后生成方案') }}>使用推荐设置</button></div>
      <label className="field"><span>文章</span><ArticlePicker value={articleId} onChange={id => void (async () => { if (await canDiscard()) onArticleChange(id) })()} /></label>
      <label className="field"><span>方案模型</span><Select ariaLabel="配图方案模型" value={textTarget} onChange={setTextTarget} options={textModels.map(m => ({ value: encodeModelTarget(m.provider.id,m.model.modelId), label: m.model.displayName, hint: m.provider.displayName }))} /></label>
      <label className="field"><span>生图模型</span><Select ariaLabel="配图生图模型" value={imageTarget} onChange={setImageTarget} emptyText="还没有可用的生图模型：到「AI 服务」给供应商勾选「图片生成」能力后，模型会出现在这里" options={imageModels.map(m => ({ value: encodeModelTarget(m.provider.id,m.model.modelId), label: m.model.displayName, hint: m.provider.displayName }))} /></label>
      <label className="field"><span>正文图数量</span><select value={count} onChange={e => setCount(e.target.value)}><option value="auto">AI 推荐（0—8 张）</option>{[0,1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} 张</option>)}</select></label>
      <label className="field"><span>配图密度</span><select value={density} onChange={e => setDensity(e.target.value as typeof density)}><option value="minimal">精简</option><option value="standard">标准</option><option value="rich">丰富</option></select></label>
      <label><input type="checkbox" checked={cover} onChange={e => setCover(e.target.checked)} />公众号封面</label>
      <label><input type="checkbox" checked={header} onChange={e => setHeader(e.target.checked)} />正文顶部图</label>
      <button className="button primary" disabled={!article || !textTarget} onClick={() => void run('规划内容', async () => { if (!(await canDiscard())) return; const next = await api().plan({ ...target(textTarget), articleId, count: count === 'auto' ? 'auto' : Number(count), density, cover, header, maxInline: 8 }); await reload(next.id);setStage('style') })}>AI 生成配图方案</button>
    </fieldset>
    <details className="studio-style-library studio-style-section"><summary>配图风格库（{styles.filter(s => !s.archived).length} 个可用风格）</summary><div className="studio-style-grid">{styles.map(style => <article key={style.id} className="studio-style-card">{style.references[0] && <img src={style.references[0].url} alt={`${style.name}参考图`} />}<strong>{style.name} · V{style.version}{style.archived ? ' · 已归档' : ''}</strong><p>{style.description}</p><div className="studio-actions"><button className="button ghost compact" disabled={Boolean(busy)} onClick={() => { setStyleEdit({ id: style.id, expectedVersionId: style.versionId, name: style.name, description: style.description, colors: style.colors, medium: style.medium, composition: style.composition, avoid: style.avoid, references: style.references }); setStyleDirty(false); setHistory([]) }}>编辑</button><button className="button ghost compact" disabled={Boolean(busy)} onClick={() => void run('归档风格', async () => { await api().archiveStyle(style.id,!style.archived); setStyles(await api().styles()) })}>{style.archived ? '恢复' : '归档'}</button></div></article>)}</div>{!styles.length && <p className="form-hint">创建风格后，可上传参考图或填写风格描述，供所有文章复用。</p>}</details>
    {article?.accountId && <label className="field studio-style-section"><span>当前公众号的默认配图风格</span><select aria-label="当前公众号的默认配图风格" disabled={Boolean(busy)} value={defaultId} onChange={e => void run('绑定风格', async () => { await api().bindStyle(article.accountId!,e.target.value || null); setDefaultId(e.target.value); setNotice('默认风格已更新，下次创建配图方案时生效') })}><option value="">不设置默认</option>{styles.filter(s => !s.archived || s.id === defaultId).map(s => <option key={s.id} value={s.id}>{s.name}{s.archived ? '（已归档）' : ''}</option>)}</select></label>}
    {plans.length > 0 && <label className="field"><span>配图方案</span><select disabled={Boolean(busy)} value={plan?.id ?? ''} onChange={e => { const id = e.target.value; void run('切换方案', async () => { if (await canDiscard()) await reload(id) }) }}>{plans.map(p => <option value={p.id} key={p.id}>{p.title} · {new Date(p.createdAt).toLocaleString()} · {p.pictures.length} 张</option>)}</select></label>}
    {plan && <>
      <p>{plan.reasoning}</p><p className="form-hint">方案绑定文章版本。先编辑并保存内容清单，再生成提示词；每张图可单独修改和锁定提示词。</p>
      {article && article.currentVersionId !== plan.articleVersionId && <p className="form-hint">文章已有新版本，应用前请在预览中确认插图位置；无法匹配的位置会要求重新选择。</p>}
      <fieldset disabled={Boolean(busy)} className="studio-controls">
        <label className="field studio-style-section"><span>提示词模型</span><Select ariaLabel="配图提示词模型" value={promptTarget} onChange={setPromptTarget} options={textModels.map(({provider,model})=>({value:encodeModelTarget(provider.id,model.modelId),label:model.displayName,hint:provider.displayName}))} /></label>
        <label className="field"><span>本篇配图风格{plan.style ? ` · V${plan.style.version}` : ''}</span><select aria-label="本篇配图风格" value={plan.style?.id ?? ''} onChange={e => change({ ...plan, style: styles.find(s => s.id === e.target.value) })}><option value="">简洁通用风格</option>{styles.filter(s => !s.archived || s.id === plan.style?.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {plan.style && styles.some(s => s.id === plan.style!.id && s.versionId !== plan.style!.versionId) && <button className="button ghost" onClick={() => change({ ...plan, style: styles.find(s => s.id === plan.style!.id) })}>使用此风格的最新版本</button>}
        <label className="field"><span>参考方式</span><select value={referenceMode} onChange={e => setReferenceMode(e.target.value as typeof referenceMode)}><option value="image">图片参考（风格有参考图时）</option><option value="text">仅文字风格描述</option></select></label>

        <button className="button secondary" disabled={dirty || !promptTarget} onClick={() => void run('生成提示词', async () => { const next = await api().prompts({ ...target(promptTarget), planId: plan.id, expectedRevision: plan.revision }); setPlan(next);setStage('images'); setNotice('提示词已生成，已锁定的提示词保持原内容') })}>生成／更新提示词</button>
        <button className="button ghost" disabled={plan.pictures.length >= 12} onClick={() => { const slot = Math.max(plan.nextSlot,...plan.pictures.map(p => p.slot + 1),...assets.map(a => a.slot + 1)); change({ ...plan, pictures: [...plan.pictures, { id: crypto.randomUUID(), kind: 'inline', slot, subject: '新增配图', purpose: '', ratio: '16:9', alt: '', caption: '', priority: 'optional', anchor: { block: '', occurrence: 0, placement: 'top' }, prompt: '', promptLocked: false }] }) }}>新增正文图</button>
      </fieldset>
      {plan.promptsStale && <p className="form-hint">内容或风格调整后，请更新提示词再生成图片。</p>}
      {plan.pictures.map((picture,index) => {
        const candidates = assets.filter(a => a.slot === picture.slot && a.kind === (picture.kind === 'header' ? 'inline' : picture.kind))
        return <article className="studio-picture" key={picture.id}>
          <div className="studio-step-title"><strong>{index+1}. {label[picture.kind]} · {picture.subject}</strong><div className="studio-actions"><button disabled={Boolean(busy) || index === 0} className="button ghost compact" onClick={() => { const next = [...plan.pictures]; [next[index-1],next[index]] = [next[index],next[index-1]]; change({ ...plan,pictures:next }) }}>上移</button><button disabled={Boolean(busy)} className="button ghost compact" onClick={() => change({ ...plan,pictures:plan.pictures.filter(p => p.id !== picture.id) })}>移除图片项</button></div></div>
          <fieldset disabled={Boolean(busy)} className="studio-picture-fields">
            <label className="field" data-field="brief"><span>画面内容</span><textarea value={picture.subject} onChange={e => editPicture(picture.id,{ subject:e.target.value })} /></label>
            <label className="field" data-field="brief"><span>配图理由</span><textarea value={picture.purpose} onChange={e => editPicture(picture.id,{ purpose:e.target.value })} /></label>
            <label className="field" data-field="brief"><span>比例</span><select value={picture.ratio} onChange={e => editPicture(picture.id,{ ratio:e.target.value })}>{['21:9','16:9','4:3','3:4','1:1'].map(r => <option key={r}>{r}</option>)}</select></label>
            <label className="field" data-field="style"><span>单张风格</span><select value={picture.style?.id ?? ''} onChange={e => editPicture(picture.id,{ style: styles.find(s => s.id === e.target.value) })}><option value="">沿用本篇风格</option>{styles.filter(s => !s.archived).map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select>{picture.style && <small>本图使用独立风格，可能与整篇不同</small>}</label>
            {picture.kind === 'inline' && <label className="field studio-wide" data-field="brief"><span>插入位置（当前文章段落之后）</span><select value={JSON.stringify(picture.anchor)} onChange={e => editPicture(picture.id,{ anchor:JSON.parse(e.target.value) })}><option value={JSON.stringify({block:'',occurrence:0,placement:'top'})}>正文顶部</option>{!blocks.some(b => b.text === picture.anchor.block && b.occurrence === picture.anchor.occurrence) && picture.anchor.placement !== 'top' && <option value={JSON.stringify(picture.anchor)}>原位置已变化，请重新选择</option>}{blocks.filter(b => !/```|~~~/.test(b.text)).map((b,i) => <option key={i} value={JSON.stringify({versionId:article?.currentVersionId,block:b.text,occurrence:b.occurrence,placement:'after'})}>{b.text.slice(0,90)}</option>)}</select></label>}
            <label className="field" data-field="brief"><span>替代文本</span><input value={picture.alt} onChange={e => editPicture(picture.id,{ alt:e.target.value })} /></label>
            <label className="field" data-field="brief"><span>图注（留空则隐藏）</span><input value={picture.caption} onChange={e => editPicture(picture.id,{ caption:e.target.value })} /></label>
            <label data-field="brief"><input type="checkbox" checked={picture.priority === 'required'} onChange={e => editPicture(picture.id,{ priority:e.target.checked ? 'required' : 'optional' })} />应用前必须选图</label>
            <label data-field="prompt"><input type="checkbox" checked={picture.promptLocked} onChange={e => editPicture(picture.id,{ promptLocked:e.target.checked })} />锁定本图提示词</label>
            <label className="field studio-wide" data-field="prompt"><span>生图提示词</span><textarea rows={4} value={picture.prompt} onChange={e => editPicture(picture.id,{ prompt:e.target.value })} /></label>
          </fieldset>
          <div className="studio-actions studio-image-actions"><button className="button secondary" disabled={unavailable || (picture.promptStale ?? plan.promptsStale) || !picture.prompt || !imageTarget || jobs.some(j=>j.pictureId===picture.id&&['queued','running','recovering'].includes(j.status))} onClick={() => void run('生成样图',() => generateOne(picture))}>{candidates.length ? '重新生成候选图' : '生成本图／样图'}</button><label className="button ghost">导入本地候选图<input disabled={unavailable} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value=''; if(file) void run('导入候选图',async () => { const imported=await window.moliu.visuals.importImageData({ packId:plan.id,kind:picture.kind==='header'?'inline':picture.kind,slot:picture.slot,prompt:picture.prompt,fileName:file.name,data:await file.arrayBuffer() }); await refreshProgress(plan.id) }) }} /></label></div>
          <div className="studio-candidates">{candidates.map(asset => <figure key={asset.id}><img src={asset.url} alt={picture.alt || picture.subject} /><figcaption><small>{assetStates.find(s=>s.assetId===asset.id)?.status==='outdated'?'基于旧内容／旧风格，需要更新':assetStates.find(s=>s.assetId===asset.id)?.status==='current'?'符合当前方案':'导入或历史图片，请核对效果'}</small><button className="button secondary compact" disabled={unavailable || picture.selectedAssetId===asset.id&&(assetStates.find(s=>s.assetId===asset.id)?.status==='current'||picture.approvedAssetSignature===pictureSignature(plan,picture))} onClick={() => void run('采用图片',async () => { const state=assetStates.find(s=>s.assetId===asset.id)?.status;const outdated=state==='outdated'||state==='unverified'&&asset.source==='generated';if(outdated&&!(await confirm({title:'沿用旧内容或旧风格的图片？',message:'这张图的生成参数与当前方案不同。确认后会沿用此图；也可以重新生成。',confirmLabel:'确认沿用'})))return;setPlan(await api().select({planId:plan.id,pictureId:picture.id,assetId:asset.id,expectedRevision:plan.revision,allowOutdated:outdated})) })}>{picture.selectedAssetId===asset.id ? assetStates.find(s=>s.assetId===asset.id)?.status==='outdated'&&picture.approvedAssetSignature!==pictureSignature(plan,picture)?'确认沿用旧图':'已采用' : '采用此图'}</button><button className="button ghost compact" disabled={Boolean(busy)} onClick={() => void run('创建风格',async () => { const ref = await api().referenceFromAsset(asset.id); setStyleEdit({...newStyle(),name:'新配图风格',references:[ref]});setStyleDirty(true) })}>存为风格</button></figcaption></figure>)}</div>
        </article>
      })}
      {/* 批量按钮在未选生图模型时会被禁用：就近解释原因，并给一键回第 1 步的路径 */}
      {!imageTarget && <p className="inline-alert studio-image-section" role="status">还没有选择生图模型，批量生成暂不可用。<button className="text-button" onClick={() => setStage('plan')}>回到第 1 步选择生图模型</button>，选好后这里可以一键生成全部候选图。</p>}
      <div className="studio-actions"><button className="button primary studio-image-section" disabled={unavailable || !imageTarget || plan.pictures.every(p=>p.promptStale ?? plan.promptsStale)} onClick={() => void run('批量生成',generateBatch)}>生成剩余图片／更新旧图</button><button className="button secondary" disabled={unavailable} onClick={() => void run('预览配图',async () => { setStage('apply');const next = await api().preview(plan.id); const layout = await window.moliu.layouts.renderPreview({articleId:plan.articleId,markdown:next.markdown,platform:'wechat'});setPreview(next);setPreviewHtml(layout.html) })}>预览并应用文章</button><button className="button ghost" disabled={unavailable || !lastAppliedVersion} onClick={() => void run('撤销应用',async () => {await api().undo({planId:plan.id,expectedVersionId:lastAppliedVersion});setLastAppliedVersion('');await onApplied();setNotice('已撤销本次配图，文章保留历史版本') })}>撤销本次应用</button></div>
      <p className="form-hint">建议先生成一张样图，采用满意的效果后再批量生成。参考图主要约束色彩和质感，实际一致性取决于所选模型；不支持参考图时可显式切换文字模式。</p>
    </>}
    {busy && <div role="status" className="studio-actions"><span>{busy}…</span><button className="button danger compact" onClick={() => { stop.current=true; void window.moliu.generation.cancel('visuals') }}>停止任务</button></div>}
    {styleEdit && <ModalBase open titleId="visual-style-editor" onClose={() => { if(!busy) void closeStyle() }}><div className="studio-dialog"><h2 id="visual-style-editor">{styleEdit.id ? '编辑配图风格' : '创建配图风格'}</h2><fieldset disabled={Boolean(busy)}>
      {([['name','风格名称'],['description','风格描述'],['medium','表现方式／材质'],['colors','色彩'],['composition','构图规则'],['avoid','避免内容']] as const).map(([key,title]) => <label className="field" key={key}><span>{title}</span><textarea value={styleEdit[key]} onChange={e => updateStyle({[key]:e.target.value})} /></label>)}
      <label className="field"><span>主参考图（PNG／JPG／WebP，10MB 以内）</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {const file=e.target.files?.[0];if(file) void run('保存参考图',async()=>{updateStyle({references:[await api().importReference(await file.arrayBuffer())]})})}} /></label>
      <button className="button secondary" disabled={!imageTarget || !styleEdit.name.trim()} onClick={() => void run('生成风格样图',async()=>{const ref=await api().sampleStyle({...target(imageTarget),style:styleEdit});updateStyle({references:[ref]})})}>按描述生成风格样图</button>
      <small>样图使用所选生图模型，会产生一次生图费用。各风格使用同一书桌主题，便于比较效果。</small>
      {styleEdit.references[0] && <><img className="studio-reference" src={styleEdit.references[0].url} alt="风格参考图" /><div className="studio-actions"><button className="button ghost" disabled={!textTarget} onClick={() => void run('分析参考图',async()=>{updateStyle({description:await api().analyzeReference({...target(textTarget),referenceId:styleEdit.references[0].id})})})}>AI 提取风格描述</button><button className="button ghost" onClick={()=>updateStyle({references:[]})}>移除参考图</button></div></>}
<details><summary>风格样图记录与恢复</summary>{samples.slice(0,10).map(task=><div className="studio-sample-record" key={task.id}><p>{task.style.name} · {{running:'生成中',completed:'已完成',unknown:'结果待核对',failed:'失败'}[task.status]}</p>{task.reference&&<><img className="studio-reference" src={task.reference.url} alt={task.style.name}/><button className="button ghost" onClick={()=>updateStyle({name:task.style.name,description:task.style.description,medium:task.style.medium,colors:task.style.colors,composition:task.style.composition,avoid:task.style.avoid,references:[task.reference!]})}>载入这张样图及风格参数</button></>}{task.error&&<p className="form-hint">{task.error}</p>}</div>)}<button className="button secondary" onClick={()=>void run('续查样图',async()=>{await api().recheckSamples();setSamples(await api().samples())})}>续查已提交样图（不重新生图）</button></details>
      {styleEdit.id && <button className="button ghost" onClick={()=>void run('读取历史',async()=>setHistory(await api().styleHistory(styleEdit.id!)))}>查看历史版本</button>}
      {history.map(s=><div key={s.versionId}>V{s.version} · {s.name}<button className="button ghost compact" onClick={()=>updateStyle({name:s.name,description:s.description,medium:s.medium,colors:s.colors,composition:s.composition,avoid:s.avoid,references:s.references})}>载入参数</button></div>)}
    </fieldset>{error && <p role="alert" className="inline-alert">{error}</p>}<div className="studio-actions"><button className="button primary" disabled={Boolean(busy)||!styleEdit.name.trim()} onClick={()=>void run('保存风格',async()=>{await api().saveStyle(styleEdit);setStyles(await api().styles());setStyleEdit(null);setStyleDirty(false);setNotice('风格已保存，可在方案中选择')})}>保存风格版本</button><button className="button ghost" disabled={Boolean(busy)} onClick={()=>void closeStyle()}>关闭</button>{busy && <button className="button danger" onClick={() => void window.moliu.generation.cancel('visuals')}>停止任务</button>}</div></div></ModalBase>}
    {preview && <ModalBase open titleId="visual-application-preview" onClose={()=>{if(!busy)setPreview(null)}}><div className="studio-dialog"><h2 id="visual-application-preview">配图应用预览</h2><p>插入 {preview.inserted} 张正文图片{preview.coverAssetId ? '，并设置公众号封面' : ''}。确认后保存为文章新版本。</p>{preview.conflicts.map(c=><p className="inline-alert" key={c}>{c}</p>)}{preview.suggestions?.map((suggestion,i)=><div className="studio-anchor-suggestion" key={i}><p>原位置：{suggestion.previousBlock.slice(0,180)}</p><p>建议位置：{suggestion.anchor.block.slice(0,180)}（文本相似度 {Math.round(suggestion.score*100)}%）</p><button className="button secondary" disabled={Boolean(busy)} onClick={()=>void run('确认插图位置',async()=>{const saved=await api().savePlan({...plan!,pictures:plan!.pictures.map(p=>p.id===suggestion.pictureId?{...p,anchor:suggestion.anchor}:p)});setPlan(saved);const next=await api().preview(saved.id);setPreview(next);const layout=await window.moliu.layouts.renderPreview({articleId:saved.articleId,markdown:next.markdown,platform:'wechat'});setPreviewHtml(layout.html)})}>确认此位置并重新预览</button></div>)}<article className="layout-html studio-article-preview" dangerouslySetInnerHTML={{__html:sanitizeHtml(previewHtml)}} /><div className="studio-actions"><button className="button primary" disabled={Boolean(busy)||preview.conflicts.length>0} onClick={()=>void run('应用配图',async()=>{const result=await api().apply({planId:plan!.id,expectedRevision:plan!.revision,baseVersionId:preview.baseVersionId});setLastAppliedVersion(result.currentVersionId);setPreview(null);await onApplied();setNotice('图片已应用并保存为文章新版本')})}>确认应用并保存版本</button><button className="button ghost" disabled={Boolean(busy)} onClick={()=>setPreview(null)}>返回调整</button></div>{error&&<p role="alert" className="inline-alert">{error}</p>}</div></ModalBase>}
    {ConfirmPortal}
  </section>
}
