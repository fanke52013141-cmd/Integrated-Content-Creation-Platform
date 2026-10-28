import MarkdownIt from 'markdown-it'

export const richMarkdown = new MarkdownIt({ html: false, linkify: true, breaks: false })

const blockTokens = new Set([
  'heading_open', 'heading_close', 'paragraph_open', 'paragraph_close',
  'bullet_list_open', 'bullet_list_close', 'ordered_list_open', 'ordered_list_close',
  'list_item_open', 'list_item_close', 'blockquote_open', 'blockquote_close', 'hr', 'inline'
])
const inlineTokens = new Set([
  'text', 'softbreak', 'hardbreak', 'strong_open', 'strong_close', 'em_open', 'em_close',
  's_open', 's_close', 'code_inline', 'link_open', 'link_close', 'image'
])

/**
 * A conservative token gate for the visual editor. A rejected document stays in
 * source mode, so unsupported Markdown never needs a lossy conversion.
 */
export function supportsBasicRichText(markdown: string): boolean {
  // Raw HTML cannot be faithfully preserved after a contenteditable round trip.
  if (/<\/?[a-z][^>]*>/i.test(markdown) || /(^|\n)\[.+\]:\s*\S+/.test(markdown) || /\[\^[^\]]+\]/.test(markdown)) return false
  const tokens = richMarkdown.parse(markdown, {})
  for (const token of tokens) {
    if (!blockTokens.has(token.type)) return false
    // Nested lists and blockquotes change structure if the browser edits their DOM.
    if ((token.type === 'bullet_list_open' || token.type === 'ordered_list_open' || token.type === 'blockquote_open') && token.level > 0) return false
    // Serializing starts at 1 is safe; other starting values would silently change.
    if (token.type === 'ordered_list_open' && token.attrGet('start') && token.attrGet('start') !== '1') return false
    if (token.type === 'inline' && token.children?.some(child => !inlineTokens.has(child.type))) return false
  }
  return true
}
