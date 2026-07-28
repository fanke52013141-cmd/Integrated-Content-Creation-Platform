import type { CreateArticleLayoutInput, LayoutPlatform } from '../../shared/contracts.js'
import type { AppDatabase } from '../database.js'

export class ArticleLayoutService {
  constructor(private readonly database: AppDatabase) {}
  create(input: CreateArticleLayoutInput) {
    const article = this.database.getArticle(input.articleId)
    if (!article) throw new Error('文章不存在')
    const rendered = render(article.rawMarkdown, input.platform)
    return this.database.saveArticleLayout({ articleId: article.id, articleVersionId: article.currentVersionId, articleStatusSnapshot: article.status, platform: input.platform, ...rendered })
  }
}

function render(markdown:string, platform:LayoutPlatform):{title:string;html:string;plainText:string} {
  const lines=markdown.trim().split(/\r?\n/);const title=(lines.find(line=>/^#\s+/.test(line))?.replace(/^#\s+/,'')||'未命名文章').trim();const body=lines.filter(line=>!/^#\s+/.test(line));const plain=platform==='xiaohongshu'?toXiaohongshu(title,body):[title,...body].join('\n').trim();return {title,plainText:plain,html:toHtml(title,body,platform)}
}
function toHtml(title:string,lines:string[],platform:LayoutPlatform):string { const accent=platform==='wechat'?'#07c160':'#e65a7a';const content=lines.map(line=>{const safe=escapeHtml(line.replace(/^[-*]\s+/,''));if(/^##\s+/.test(line))return `<h2 style="margin:30px 0 14px;color:${accent};font-size:20px;line-height:1.5">${escapeHtml(line.replace(/^##\s+/,''))}</h2>`;if(/^###\s+/.test(line))return `<h3 style="margin:22px 0 10px;font-size:17px">${escapeHtml(line.replace(/^###\s+/,''))}</h3>`;if(/^[-*]\s+/.test(line))return `<p style="margin:8px 0;padding-left:14px">• ${safe}</p>`;if(/^>\s+/.test(line))return `<blockquote style="margin:16px 0;padding:8px 14px;border-left:3px solid ${accent};background:#f6f7f8;color:#666">${escapeHtml(line.replace(/^>\s+/,''))}</blockquote>`;if(!line.trim())return '';return `<p style="margin:0 0 16px;font-size:16px;line-height:1.9;color:#333">${safe}</p>`}).join('');return `<article style="max-width:720px;margin:auto;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif"><h1 style="margin:0 0 26px;font-size:28px;line-height:1.4;color:#171717">${escapeHtml(title)}</h1>${content}</article>` }
function toXiaohongshu(title:string,lines:string[]):string{return [`# ${title}`, '', ...lines.map(line=>line.startsWith('## ')?`✨ ${line.slice(3)}`:line.startsWith('### ')?`· ${line.slice(4)}`:line)].join('\n').replace(/\n{3,}/g,'\n\n').trim()}
function escapeHtml(value:string):string{return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
