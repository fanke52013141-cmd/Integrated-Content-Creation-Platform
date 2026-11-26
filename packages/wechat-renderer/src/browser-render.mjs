/**
 * Executed inside the real doocs page. Keep this function self-contained:
 * Puppeteer serializes it and none of the Node module closures are available.
 */
export async function renderInDoocsPage({
  markdown,
  themeId,
  customCSS,
  themeOptions,
  moduleBase,
  settleDelayMs,
}) {
  const customCssTabName = '__wechat_chromium_renderer__'
  const themeOptionKeys = [
    'primaryColor', 'fontFamily', 'fontSize', 'lineHeight', 'blockSpacing',
    'linkColor', 'blockquoteBackground', 'codeBlockTheme', 'headingStyles', 'legend',
    'isCiteStatus', 'isShowLineNumber', 'isMacCodeBlock', 'isCountStatus',
    'isUseIndent', 'isUseJustify',
  ]

  const [
    { useEditorStore },
    { useRenderStore },
    { useThemeStore },
    { useCssEditorStore },
    { processClipboardContent },
  ] = await Promise.all([
    import(`${moduleBase}/stores/editor.ts`),
    import(`${moduleBase}/stores/render.ts`),
    import(`${moduleBase}/stores/theme.ts`),
    import(`${moduleBase}/stores/cssEditor.ts`),
    import(`${moduleBase}/services/export/clipboard.ts`),
  ])

  const editorStore = useEditorStore()
  const renderStore = useRenderStore()
  const themeStore = useThemeStore()
  const cssEditorStore = useCssEditorStore()

  await renderStore.initRendererInstance()

  themeStore.theme = themeId
  // Reset every mutable theme field before applying this request's overrides.
  // Otherwise a reused page would leak the previous document's theme options.
  themeStore.resetStyle()
  for (const key of themeOptionKeys) {
    if (themeOptions[key] !== undefined) themeStore[key] = themeOptions[key]
  }

  // Reuse one fixed custom-CSS tab, including empty CSS, to prevent both tab
  // growth and old CSS leaking into the next document.
  const tabs = cssEditorStore.cssContentConfig.tabs
  let customTab = tabs.find(tab => tab.name === customCssTabName)
  if (!customTab) {
    cssEditorStore.addCssContentTab(customCssTabName, customCSS)
    customTab = tabs.find(tab => tab.name === customCssTabName)
  }
  else {
    cssEditorStore.tabChanged(customTab.id)
    customTab.content = customCSS
  }

  await themeStore.applyCurrentTheme()
  themeStore.updateCodeTheme()
  editorStore.importContent(markdown)
  renderStore.render(markdown, { force: true, themeMode: 'light' })

  // The editor has its own 300ms refresh debounce. processClipboardContent also
  // waits two Vue ticks and up to 20s for async formulas and diagrams.
  await new Promise(resolve => setTimeout(resolve, settleDelayMs))
  const rendered = await processClipboardContent(themeStore.primaryColor)

  const resultDocument = document.implementation.createHTMLDocument('render-result')
  resultDocument.body.innerHTML = rendered.html
  const images = [...resultDocument.querySelectorAll('img')].map(image => ({
    src: image.getAttribute('src') ?? '',
    alt: image.getAttribute('alt') ?? '',
  }))
  const headings = [...resultDocument.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(heading => ({
    level: Number(heading.tagName.slice(1)),
    text: heading.textContent ?? '',
  }))

  return {
    ...rendered,
    sourceFromEditor: editorStore.getContent(),
    images,
    headings,
  }
}
