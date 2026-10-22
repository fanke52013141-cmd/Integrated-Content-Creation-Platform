import type { Article, VisualAsset, ImageQuality, ImageResolution } from './contracts.js'

export interface StyleReference { id: string; fileName: string; url: string }
export interface VisualStyleInput {
  id?: string; expectedVersionId?: string; name: string; description: string
  colors: string; medium: string; composition: string; avoid: string
  references: StyleReference[]
}
export interface VisualStyle extends VisualStyleInput {
  id: string; versionId: string; version: number; archived: boolean; createdAt: string
}
export interface PictureAnchor { versionId?: string; block: string; occurrence: number; placement: 'before' | 'after' | 'top' }
export interface PictureBrief {
  id: string; kind: 'cover' | 'header' | 'inline' | 'release'; slot: number
  subject: string; purpose: string; ratio: string; alt: string; caption: string
  anchor: PictureAnchor; priority: 'required' | 'optional'
  prompt: string; promptLocked: boolean; style?: VisualStyle
  selectedAssetId?: string
  promptStale?: boolean
  approvedAssetSignature?: string
}
export interface VisualPlan {
  id: string; articleId: string; articleVersionId: string; sourceMarkdown: string
  revision: number; nextSlot: number; title: string; reasoning: string; pictures: PictureBrief[]
  style?: VisualStyle; promptsStale: boolean; createdAt: string
}
export interface PlanVisualsInput {
  articleId: string; providerId: string; model: string
  count: number | 'auto'; density: 'minimal' | 'standard' | 'rich'
  cover: boolean; header: boolean; maxInline: number
}
export interface VisualModelTarget { providerId: string; model: string }
export interface GeneratePictureInput extends VisualModelTarget {
  planId: string; pictureId: string; expectedRevision: number; referenceMode: 'image' | 'text'
  quality?: ImageQuality; resolution?: ImageResolution
}
export interface VisualPlanDraft { planId: string; revision: number; baseRevision: number; plan: VisualPlan | null; updatedAt: string }
export interface VisualImageJob {
  id: string; planId: string; pictureId: string; signature: string; input: GeneratePictureInput
  status: 'queued' | 'running' | 'recovering' | 'completed' | 'failed' | 'paused' | 'unknown'
  remoteTaskId?: string; assetId?: string; error?: string
  createdAt: string; updatedAt: string
}
export interface VisualAssetState { assetId: string; status: 'current' | 'outdated' | 'unverified' }
export interface StyleSampleTask {
  id: string; style: VisualStyleInput; providerId: string; model: string
  status: 'running'|'completed'|'unknown'|'failed'; remoteTaskId?: string
  reference?: StyleReference; error?: string; createdAt: string
}
export interface ApplyVisualPreview {
  markdown: string; baseVersionId: string; conflicts: string[]
  coverAssetId?: string; inserted: number
  suggestions?: Array<{ pictureId: string; previousBlock: string; anchor: PictureAnchor; score: number }>
}
export interface VisualStudioApi {
  styles(): Promise<VisualStyle[]>
  saveStyle(input: VisualStyleInput): Promise<VisualStyle>
  archiveStyle(id: string, archived: boolean): Promise<void>
  styleHistory(id: string): Promise<VisualStyle[]>
  importReference(data: ArrayBuffer): Promise<StyleReference>
  referenceFromAsset(assetId: string): Promise<StyleReference>
  analyzeReference(input: VisualModelTarget & { referenceId: string }): Promise<string>
  sampleStyle(input: VisualModelTarget & { style: VisualStyleInput }): Promise<StyleReference>
  samples(): Promise<StyleSampleTask[]>
  recheckSamples(): Promise<void>
  defaultStyle(accountId: string): Promise<VisualStyle | null>
  bindStyle(accountId: string, styleId: string | null): Promise<void>
  plans(articleId: string): Promise<VisualPlan[]>
  plan(input: PlanVisualsInput): Promise<VisualPlan>
  savePlan(input: VisualPlan, draftRevision?: number): Promise<VisualPlan>
  getDraft(planId: string): Promise<VisualPlanDraft | null>
  saveDraft(input: { plan: VisualPlan; expectedRevision: number }): Promise<VisualPlanDraft>
  discardDraft(planId: string, revision: number): Promise<void>
  assetStates(planId: string): Promise<VisualAssetState[]>
  jobs(planId: string): Promise<VisualImageJob[]>
  enqueue(input: GeneratePictureInput): Promise<VisualImageJob>
  controlJob(input: { id: string; action: 'pause' | 'resume' | 'retry' | 'check-result' | 'confirm-not-submitted' }): Promise<void>
  prompts(input: VisualModelTarget & { planId: string; expectedRevision: number }): Promise<VisualPlan>
  generate(input: GeneratePictureInput): Promise<VisualAsset>
  select(input: { planId: string; pictureId: string; assetId: string; expectedRevision: number; allowOutdated?: boolean }): Promise<VisualPlan>
  preview(planId: string): Promise<ApplyVisualPreview>
  apply(input: { planId: string; expectedRevision: number; baseVersionId: string }): Promise<Article>
  undo(input: { planId: string; expectedVersionId: string }): Promise<Article>
}

/** Stable generation content; excludes placement/captions/adoption so those changes never waste images. */
export function pictureSignature(plan: VisualPlan, picture: PictureBrief): string {
  const style = picture.style ?? plan.style
  return JSON.stringify({ subject: picture.subject, purpose: picture.purpose, ratio: picture.ratio, prompt: picture.prompt,
    style: style?.versionId ?? null, refs: style?.references.map(ref => ref.id) ?? [] })
}

export function blockSimilarity(left: string, right: string): number {
  const grams=(text: string)=>{
    const normalized=text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')
    return new Set(normalized.length<2?[normalized]:Array.from({length:normalized.length-1},(_,i)=>normalized.slice(i,i+2)))
  }
  const a=grams(left),b=grams(right)
  if(!left.trim()||!right.trim())return 0
  return 2*[...a].filter(item=>b.has(item)).length/(a.size+b.size)
}

/** Paragraph snapshots disambiguate identical text without depending on changing line numbers. */
export function articleBlocks(markdown: string): Array<{ text: string; start: number; end: number; occurrence: number }> {
  const result: Array<{ text: string; start: number; end: number; occurrence: number }> = []
  const seen = new Map<string, number>()
  let start: number | null = null, end = 0, fence = ''
  const flush = () => {
    if (start === null) return
    const text = markdown.slice(start,end).trimEnd()
    const occurrence = seen.get(text) ?? 0
    seen.set(text, occurrence + 1)
    result.push({ text, start, end: start + text.length, occurrence })
    start = null
  }
  for (const line of markdown.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!line[0]) continue
    if (!line[0].trim() && !fence) { flush(); continue }
    if (start === null) start = line.index
    end = line.index + line[0].length
    const marker = line[0].match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''
    }
  }
  flush()
  return result
}

export function styleDescription(style?: VisualStyle): string {
  return style ? `${style.name}。${style.description}。表现方式：${style.medium}。色彩：${style.colors}。构图：${style.composition}。避免：${style.avoid}` : '清晰、简洁、与文章主题一致'
}
