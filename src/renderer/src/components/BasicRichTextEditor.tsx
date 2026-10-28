import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { richMarkdown, supportsBasicRichText } from '../../../shared/rich-text-markdown'

export { supportsBasicRichText } from '../../../shared/rich-text-markdown'

export interface BasicRichTextEditorHandle {
  insertImage(alt: string, url: string): void
}

function escapeText(value: string): string {
  // Prevent ordinary text typed in the visual editor from becoming Markdown
  // syntax when it is persisted (for example "#", "1." or "[link]").
  return value.replace(/([\\`*_{}\[\]<>#+.!|~>-])/g, '\\$1')
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '')
  if (!(node instanceof HTMLElement)) return ''
  const children = Array.from(node.childNodes).map(inlineMarkdown).join('')
  switch (node.tagName) {
    case 'STRONG': case 'B': return `**${children}**`
    case 'EM': case 'I': return `*${children}*`
    case 'S': case 'DEL': return `~~${children}~~`
    case 'CODE': {
      const code = node.textContent ?? ''
      const fence = '`'.repeat(Math.max(1, ...Array.from(code.matchAll(/`+/g), match => match[0].length + 1)))
      return `${fence}${code.includes('`') ? ` ${code} ` : code}${fence}`
    }
    case 'A': return `[${children}](${node.getAttribute('href') ?? ''})`
    case 'IMG': return `![${node.getAttribute('alt') ?? ''}](${node.getAttribute('src') ?? ''})`
    case 'BR': return '  \n'
    default: return children
  }
}

function blockMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '')
  if (!(node instanceof HTMLElement)) return ''
  const tag = node.tagName
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineMarkdown(node).trim()}`
  if (tag === 'P' || tag === 'DIV') return inlineMarkdown(node).trim()
  if (tag === 'HR') return '---'
  if (tag === 'IMG') return inlineMarkdown(node)
  if (tag === 'BLOCKQUOTE') return Array.from(node.childNodes).map(blockMarkdown).filter(Boolean).flatMap(line => line.split('\n')).map(line => `> ${line}`).join('\n')
  if (tag === 'UL' || tag === 'OL') return Array.from(node.children).filter(child => child.tagName === 'LI').map((item, index) => `${tag === 'OL' ? `${index + 1}.` : '-'} ${inlineMarkdown(item).trim()}`).join('\n')
  return inlineMarkdown(node).trim()
}

export function richTextHtmlToMarkdown(root: HTMLElement): string {
  return Array.from(root.childNodes).map(blockMarkdown).filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + (root.textContent?.trim() ? '\n' : '')
}

function markdownToEditorHtml(markdown: string): string { return richMarkdown.render(markdown) || '<p><br></p>' }

// Browsers can create nested blocks while editing even when the original
// Markdown was simple. Never flatten unknown structure into the saved draft.
function isSafeEditorDom(root: HTMLElement): boolean {
  const inlineTags = new Set(['STRONG', 'B', 'EM', 'I', 'S', 'DEL', 'CODE', 'A', 'IMG', 'BR'])
  const inline = (node: Node): boolean => node.nodeType === Node.TEXT_NODE || node instanceof HTMLElement && inlineTags.has(node.tagName) && Array.from(node.childNodes).every(inline)
  const block = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) return true
    if (!(node instanceof HTMLElement)) return false
    if (/^H[1-6]$/.test(node.tagName) || ['P', 'DIV'].includes(node.tagName)) return Array.from(node.childNodes).every(inline)
    if (['HR', 'IMG', 'BR'].includes(node.tagName)) return true
    if (node.tagName === 'BLOCKQUOTE') return Array.from(node.childNodes).every(block)
    if (['UL', 'OL'].includes(node.tagName)) return Array.from(node.children).every(child => child.tagName === 'LI' && Array.from(child.childNodes).every(inline))
    return false
  }
  return Array.from(root.childNodes).every(block)
}

function normalisedHtml(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html
  return container.innerHTML.replace(/>\s+</g, '><').trim()
}

/** Reject a document unless its initial HTML can make a semantic Markdown round trip. */
export function canSafelyUseBasicRichText(markdown: string): boolean {
  if (!supportsBasicRichText(markdown) || typeof document === 'undefined') return false
  const container = document.createElement('div')
  container.innerHTML = markdownToEditorHtml(markdown)
  const roundTripped = richTextHtmlToMarkdown(container)
  return normalisedHtml(markdownToEditorHtml(markdown)) === normalisedHtml(markdownToEditorHtml(roundTripped))
}

export const BasicRichTextEditor = forwardRef<BasicRichTextEditorHandle, { markdown: string; disabled?: boolean; onChange(markdown: string): void; onSave(): void }>(function BasicRichTextEditor({ markdown, disabled, onChange, onSave }, ref) {
  const editorRef = useRef<HTMLDivElement>(null)
  const renderedRef = useRef('')
  const safeHtmlRef = useRef('')
  const [editWarning, setEditWarning] = useState('')
  useEffect(() => {
    if (!editorRef.current || renderedRef.current === markdown) return
    editorRef.current.innerHTML = markdownToEditorHtml(markdown)
    safeHtmlRef.current = editorRef.current.innerHTML
    renderedRef.current = markdown
  }, [markdown])
  const emit = (): void => {
    const root = editorRef.current
    if (!root) return
    if (!isSafeEditorDom(root)) {
      root.innerHTML = safeHtmlRef.current
      setEditWarning('这次操作产生了不支持的嵌套格式，未应用该操作；已有正文保持不变。请改用源码编辑。')
      return
    }
    const next = richTextHtmlToMarkdown(root)
    safeHtmlRef.current = root.innerHTML
    setEditWarning('')
    renderedRef.current = next
    onChange(next)
  }
  const command = (name: string, value?: string): void => { editorRef.current?.focus(); document.execCommand(name, false, value); emit() }
  useImperativeHandle(ref, () => ({
    insertImage(alt, url) {
      const root = editorRef.current
      if (!root) return
      root.focus()
      document.execCommand('insertHTML', false, `<img src="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" alt="${alt.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`)
      emit()
    }
  }), [])
  return <section className="basic-rich-editor" aria-label="可视化正文编辑器">
    <div className="basic-rich-editor-bar" role="toolbar" aria-label="可视化格式">
      <button type="button" className="button ghost compact" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('formatBlock', 'h2')}>标题</button>
      <button type="button" className="button ghost compact" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('bold')}>加粗</button>
      <button type="button" className="button ghost compact" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('italic')}>斜体</button>
      <button type="button" className="button ghost compact" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('insertUnorderedList')}>列表</button>
      <button type="button" className="button ghost compact" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('formatBlock', 'blockquote')}>引用</button>
    </div>
    <p className="micro-copy">支持标题、段落、加粗、斜体、列表、引用、链接和图片。表格、嵌套列表、代码块或原始 HTML 请使用源码编辑。</p>
    {editWarning && <p className="inline-alert" role="alert">{editWarning}</p>}
    <div ref={editorRef} className="basic-rich-editor-surface article-markdown-preview" role="textbox" aria-label="可视化正文" aria-multiline="true" contentEditable={!disabled} suppressContentEditableWarning onInput={emit} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSave() } }} onPaste={event => { event.preventDefault(); const text = event.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); emit() }} />
  </section>
})
