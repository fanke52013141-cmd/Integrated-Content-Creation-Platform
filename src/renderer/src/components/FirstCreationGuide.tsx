import { BookOpenText, FileText, Lightbulb, Settings2, X } from 'lucide-react'
import type { ProviderSummary } from '../../../shared/contracts'
import type { RouteId } from './Layout'
import { ModalBase } from './ModalBase'
import { completeFirstCreationGuide } from '../../../shared/first-creation-guide'

/**
 * 首次打开时只让用户回答「从哪里开始」，不要求先理解账号、热点、模型和版式。
 * 用户的选择直接通向原有页面，所有后续能力仍按页面本身的校验逐步要求。
 */
export function FirstCreationGuide({
  open,
  providers,
  onClose,
  onNavigate
}: {
  open: boolean
  providers: ProviderSummary[]
  onClose(): void
  onNavigate(route: RouteId, params?: Record<string, string>): void
}): React.JSX.Element | null {
  const textReady = providers.some(provider => provider.enabled && provider.hasApiKey && provider.capabilities.chat && provider.verification.verified)
  const finish = (route?: RouteId, params?: Record<string, string>): void => {
    completeFirstCreationGuide(localStorage)
    onClose()
    if (route) onNavigate(route, params)
  }

  return (
    <ModalBase open={open} onClose={() => finish()} titleId="first-creation-guide-title" className="first-creation-modal" closeOnOverlay>
      <header className="first-creation-header">
        <span className="first-creation-mark"><Lightbulb size={22} /></span>
        <div><h2 id="first-creation-guide-title">从哪里开始创作？</h2><p>先选你手头已有的内容；不必先完成全部设置。</p></div>
        <button className="icon-button" aria-label="稍后再说" title="稍后再说" onClick={() => finish()}><X size={18} /></button>
      </header>
      <div className="first-creation-options">
        <button className="first-creation-option" onClick={() => finish('articles', { import: '1' })}>
          <FileText size={20} aria-hidden />
          <span><strong>我已有一篇文章</strong><small>粘贴或导入 Markdown；DOCX、HTML 可在文章页导入。</small></span>
        </button>
        <button className="first-creation-option" onClick={() => finish('materials', { returnTo: 'articles' })}>
          <BookOpenText size={20} aria-hidden />
          <span><strong>我有资料或素材</strong><small>先整理参考内容；写作时可以选择它们作为依据。</small></span>
        </button>
        <button className="first-creation-option" onClick={() => finish(textReady ? 'topics' : 'providers', textReady ? undefined : { returnTo: 'topics' })}>
          <Lightbulb size={20} aria-hidden />
          <span><strong>我只有一个想法</strong><small>{textReady ? '从选题开始，逐步形成框架和文章。' : '先连接文本 AI；配置完成后会回到选题。'}</small></span>
          {!textReady && <span className="first-creation-option-tag"><Settings2 size={14} />需配置</span>}
        </button>
      </div>
      <footer className="first-creation-footer">
        <span>没有配置 AI 也能先导入或手动写草稿。</span>
        <span className="first-creation-footer-actions">
          <button className="button ghost compact" onClick={() => finish()}>先随便看看</button>
          <button className="button secondary compact" onClick={() => finish('articles', { import: '1' })}>直接写草稿</button>
        </span>
      </footer>
    </ModalBase>
  )
}
