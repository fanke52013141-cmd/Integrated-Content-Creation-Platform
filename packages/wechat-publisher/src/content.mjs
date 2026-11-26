function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Default pure HTML replacement. A unique token is preferred for production;
 * src mode is a small convenience for the existing doocs POC markup.
 */
export function replaceImageSource(content, image, url) {
  if (image.token) {
    if (!content.includes(image.token)) throw new Error(`Image token not found: ${image.id ?? image.token}`)
    return content.split(image.token).join(image.replacement ?? url)
  }
  if (!image.src) throw new Error(`Image ${image.id ?? '<unknown>'} requires token or src`)
  const quoted = new RegExp(`(<img\\b[^>]*\\bsrc\\s*=\\s*)(["'])${escapeRegExp(image.src)}\\2`, 'gi')
  const replaced = content.replace(quoted, (_match, prefix) => `${prefix}"${url}"`)
  if (replaced === content && !content.includes(image.src)) {
    throw new Error(`Image src not found: ${image.id ?? image.src}`)
  }
  return replaced
}
