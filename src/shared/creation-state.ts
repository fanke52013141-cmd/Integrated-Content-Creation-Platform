/**
 * 创作体验里最容易出错的对象选择与草稿状态判断，集中在这里以便主进程测试直接覆盖。
 */

/** 排版稿选中态：始终限定在当前文章的排版稿集合内，避免切换文章后预览仍指向另一篇 */
export function resolveLayoutSelection<T extends { id: string; articleId: string }>(
  layouts: T[],
  articleId: string,
  currentId: string
): string {
  const scoped = layouts.filter((item) => item.articleId === articleId)
  return scoped.some((item) => item.id === currentId) ? currentId : scoped[0]?.id ?? ''
}

/** 账号定位选择的三种状态分别处理：未初始化补默认值、用户主动清空保持为空、所选账号被删除回落到默认 */
export function resolveAccountSelection(options: {
  current: string
  accounts: Array<{ id: string }>
  currentAccountId?: string
  initialized: boolean
}): { accountId: string; initialized: boolean } {
  if (!options.accounts.length) return { accountId: '', initialized: false }
  const fallback = (): string =>
    options.accounts.some((item) => item.id === options.currentAccountId) ? options.currentAccountId ?? '' : options.accounts[0].id
  if (options.current) {
    return options.accounts.some((item) => item.id === options.current)
      ? { accountId: options.current, initialized: true }
      : { accountId: fallback(), initialized: true }
  }
  return options.initialized ? { accountId: '', initialized: true } : { accountId: fallback(), initialized: true }
}

/** 评审意见是否已相对当前正文过期（评审绑定文章版本，正文改版后旧位置旧建议不再可靠） */
export function isReviewBaselineStale(
  task: { articleVersionId: string },
  article: { currentVersionId: string } | undefined
): boolean {
  return Boolean(article && task.articleVersionId && task.articleVersionId !== article.currentVersionId)
}

/** 工作草稿在本地存储里的键前缀，首页据此统计「还没保存回库里」的稿子 */
export const DRAFT_PREFIX = 'moliu:work-draft:'

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 工作草稿存储：与「已保存正文」分开，尚未落库的内容也不会因切页/重启消失 */
export function readWorkDraft(store: KeyValueStore | undefined, articleId: string): string | null {
  if (!store || !articleId) return null
  try {
    return store.getItem(`${DRAFT_PREFIX}${articleId}`)
  } catch {
    return null
  }
}

export function writeWorkDraft(store: KeyValueStore | undefined, articleId: string, value: string): void {
  if (!store || !articleId) return
  try {
    if (value) store.setItem(`${DRAFT_PREFIX}${articleId}`, value)
    else store.removeItem(`${DRAFT_PREFIX}${articleId}`)
  } catch {
    // 存储不可用时退回纯内存态
  }
}

/** 屏幕内容与库内正文是否已经分叉 */
export function isDraftDirty(local: string | null | undefined, savedMarkdown: string): boolean {
  return typeof local === 'string' && local !== savedMarkdown
}

/**
 * 同名作品在文章下拉里长得一模一样，用户无从判断选的是哪一篇。
 * 标题重复时把调用方给的区分信息（更新时间）并进副标题，让每个选项都能被读出来分辨。
 */
export function disambiguateOptions(options: Array<{ value: string; label: string; hint?: string; distinct?: string }>): Array<{ value: string; label: string; hint?: string }> {
  const counts = new Map<string, number>()
  for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1)
  return options.map(({ distinct, ...rest }) => {
    if (!distinct || (counts.get(rest.label) ?? 0) <= 1) return rest
    return { ...rest, hint: rest.hint ? `${rest.hint} · ${distinct}` : distinct }
  })
}
