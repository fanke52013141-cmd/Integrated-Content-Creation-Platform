/**
 * 表格增强：让 Markdown 表格在微信窄屏里可读。
 *
 * 微信里的表格有两个固有问题：
 * 1. 屏幕窄，宽表格会横向溢出，读者需要左右滑动
 * 2. 数字与文字混排时，左对齐的数字列极难快速对比
 *
 * 这里做两件事：
 * - 标记纯数字单元格，便于右对齐（配合主题 CSS 的 .mly-num）
 * - 给宽表格加提示，让用户知道可以横向滑动
 */

/**
 * 纯数字判定：整数、小数、百分数、千分位、货币符号、正负号。
 *
 * 刻意**不支持中文单位**（如"3 天"、"30 人"）：这类单元格往往是
 * 「数字 + 说明」的混合内容，右对齐反而更难读。宁可漏判不可误判——
 * 误判会让"3 天"这类说明文字被当成数据对齐，破坏可读性。
 */
const NUMERIC_CELL = /^\s*[+\-−]?\s*[¥$€£]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:%|‰)?\s*[¥$€£]?\s*$/

/** 判断单元格是否应视为数值列 */
export function isNumericCell(text: string): boolean {
  const trimmed = text.replace(/<[^>]+>/g, '').trim()
  if (!trimmed) return false
  // 含中文说明文字的通常不是纯数值列（如"约 30 天"）
  if (/[，。；、（）()「」【】]/.test(trimmed)) return false
  return NUMERIC_CELL.test(trimmed)
}

/**
 * 标记表格里的数值单元格。
 * 只处理 <td>，不动 <th>（表头永远左对齐）。
 */
export function markNumericCells(html: string): string {
  return html.replace(/<td(\s[^>]*)?>([\s\S]*?)<\/td>/g, (whole, attrs: string, inner: string) => {
    if (!isNumericCell(inner)) return whole
    // 已标记过则不重复加
    if (attrs?.includes('mly-num')) return whole
    return `<td${attrs ?? ''} class="mly-num">${inner}</td>`
  })
}

/**
 * 给列数过多的表格加横向滚动提示。
 *
 * 微信不支持 overflow 滚动容器（会被过滤），所以改为加一段文字提示，
 * 让读者知道"表格可以左右滑动"，而不是以为排版坏了。
 */
export function annotateWideTables(html: string): string {
  // 微信正文里section 是可用的容器标签（div 会被过滤）
  return html.replace(/<table(\s[^>]*)?>([\s\S]*?)<\/table>/g, (whole, attrs: string | undefined, inner: string) => {
    const columns = countColumns(inner)
    if (columns <= WIDE_TABLE_THRESHOLD) return whole
    return `${whole}<p class="mly-table-hint">← 表格共 ${columns} 列，可左右滑动查看完整内容 →</p>`
  })
}

/** 超过多少列就认为是宽表格。4 列在手机上基本能放下，5 列开始挤 */
const WIDE_TABLE_THRESHOLD = 4

function countColumns(tableInner: string): number {
  const firstRow = tableInner.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)?.[1]
  if (!firstRow) return 0
  return (firstRow.match(/<t[hd][\s>]/gi) ?? []).length
}
