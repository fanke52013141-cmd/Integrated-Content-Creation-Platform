function hexToRgba(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function compileColorMix(value) {
  return value.replace(/color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+(\d+(?:\.\d+)?)%,\s*transparent\)/gi, (_, hex, percentage) => {
    const alpha = Number.parseFloat(percentage) / 100
    return hexToRgba(hex, alpha)
  })
}

export function replaceTaskInputsWithStaticSymbols(root) {
  const document = root.ownerDocument ?? root
  let count = 0
  root.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    const checked = input.hasAttribute('checked') || input.checked === true
    const symbol = document.createElement('span')
    symbol.setAttribute('data-task-status', checked ? 'checked' : 'unchecked')
    symbol.setAttribute('aria-label', checked ? '已完成' : '未完成')
    symbol.textContent = checked ? '☑' : '☐'
    symbol.style.display = 'inline-block'
    symbol.style.width = '1.2em'
    symbol.style.marginRight = '4px'
    input.replaceWith(symbol)
    count += 1
  })
  return count
}

export function compileModernColors(root) {
  let count = 0
  root.querySelectorAll('[style]').forEach((element) => {
    const before = element.getAttribute('style') ?? ''
    const after = compileColorMix(before)
    if (after === before) return
    element.setAttribute('style', after)
    count += 1
  })
  return count
}
