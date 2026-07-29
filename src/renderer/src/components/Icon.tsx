import { useEffect } from 'react'

/**
 * P1-2: 全局装饰图标 a11y 治理。
 *
 * lucide-react 的 <svg> 默认不会带 aria-hidden="true"，
 * 屏幕阅读器会朗读无关图标。本 hook 通过 MutationObserver
 * 监听 DOM 变化，对所有 lucide svg（具有 lucide class）
 * 自动补 aria-hidden="true"。
 *
 * 仅在 svg 没有任何可访问属性（aria-label / role / title 子元素）时
 * 才标记为隐藏，避免覆盖有意义的图标。
 */
export function useAutoAriaHidden(): void {
  useEffect(() => {
    const markLucideSvgs = (root: ParentNode): void => {
      const targets = root.querySelectorAll<SVGSVGElement>('svg.lucide:not([aria-hidden])')
      for (const svg of targets) {
        const hasLabel =
          svg.hasAttribute('aria-label') ||
          svg.hasAttribute('aria-labelledby') ||
          svg.hasAttribute('role') ||
          svg.querySelector('title') !== null
        if (!hasLabel) svg.setAttribute('aria-hidden', 'true')
      }
    }

    markLucideSvgs(document.body)

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element
            markLucideSvgs(element)
            if (element.tagName === 'svg' && element.classList.contains('lucide')) {
              markLucideSvgs(element.parentNode ?? document.body)
            }
          }
        })
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
}
