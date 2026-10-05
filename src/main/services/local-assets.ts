export const LOCAL_ASSET_PATTERN = /moliu-asset:\/\/assets\/([^"'()\s<>]+)/g

export function localAssetName(raw: string): string {
  const name = decodeURIComponent(raw)
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || /[\x00-\x1f]/.test(name)) throw new Error('图片地址无效')
  return name
}

export function localAssetNames(content: string): string[] {
  return [...new Set([...content.matchAll(LOCAL_ASSET_PATTERN)].map(match => localAssetName(match[1])))]
}

export function replaceLocalAssets(content: string, replacements: Map<string, string>): string {
  return content.replace(LOCAL_ASSET_PATTERN, (_match, raw: string) => {
    const name = localAssetName(raw)
    const replacement = replacements.get(name)
    if (!replacement) throw new Error(`图片“${name}”未完成交付处理`)
    return replacement
  })
}
