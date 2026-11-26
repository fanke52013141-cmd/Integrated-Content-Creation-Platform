import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import {
  ContentImportError,
  assertContentReady,
  importContent,
  importDocx,
  importHtml,
  importMarkdown,
  inspectContent,
} from '../src/index.mjs'
import { crc32 } from '../src/zip.mjs'

test('Markdown normalizes front matter, blocks, links and deterministic content hash', () => {
  const source = `---\r\ntitle: "示例文章"\r\nauthor: 作者\r\ntags: [内容, 分发]\r\n---\r\n\r\n# 示例文章\r\n\r\n第一段 **加粗** 和 [链接](https://example.com/a)。\r\n\r\n- 一\r\n- 二\r\n\r\n![封面](https://example.com/a.png)\r\n\r\n\`\`\`js\r\nconst x = 1 < 2\r\n\`\`\``
  const first = importContent({ name: 'article.md', data: source })
  const second = importContent({ name: 'article.md', data: source.replace(/\r\n/g, '\n') })
  assert.equal(first.report.ready, true)
  assert.equal(first.document.metadata.title, '示例文章')
  assert.deepEqual(first.document.metadata.tags, ['内容', '分发'])
  assert.equal(first.document.blocks[0].type, 'heading')
  assert.ok(first.document.blocks.some(block => block.type === 'list'))
  assert.ok(first.document.blocks.some(block => block.type === 'code'))
  assert.equal(first.document.assets[0].uri, 'https://example.com/a.png')
  assert.deepEqual(first.document.links, ['https://example.com/a'])
  assert.match(first.document.html, /<strong>加粗<\/strong>/)
  assert.match(first.document.html, /rel="noopener noreferrer"/)
  assert.match(first.document.html, /const x = 1 &lt; 2/)
  assert.equal(first.document.contentHash, second.document.contentHash)
  assert.notEqual(first.document.source.sha256, second.document.source.sha256)
})

test('Markdown raw HTML and unsafe URLs never become active content', () => {
  const { document } = importMarkdown('# 标题\n\n<script>alert(1)</script>\n\n[坏链接](javascript:alert(1))\n\n正文')
  assert.doesNotMatch(document.html, /<script>/)
  assert.match(document.html, /&lt;script&gt;/)
  assert.doesNotMatch(document.html, /href="javascript:/)
  assert.ok(document.importWarnings.some(item => item.code === 'RAW_HTML_ESCAPED'))
  assert.ok(document.importWarnings.some(item => item.code === 'UNSAFE_LINK_URL'))
})

test('relative image references remain portable assets while active schemes are rejected', () => {
  const { document } = importMarkdown('# 标题\n\n![本地图](assets/image.png)\n\n![坏图](data:image/svg+xml;base64,AA)\n\n正文')
  assert.equal(document.assets.length, 1)
  assert.equal(document.assets[0].uri, 'assets/image.png')
  assert.match(document.html, /src="assets\/image.png"/)
  assert.doesNotMatch(document.html, /data:image/)
  assert.ok(document.importWarnings.some(item => item.code === 'UNSAFE_IMAGE_URL'))
})

test('HTML requires explicit authorization and sanitizes active content and attributes', () => {
  assert.throws(() => importHtml('<p>text</p>'), error => error.code === 'HTML_AUTHORIZATION_REQUIRED')
  const { document } = importHtml(`<!doctype html><html><head><title>授权标题</title><style>bad()</style></head><body><h1 onclick="bad()">标题</h1><p>正文 <strong>加粗</strong><script>alert(1)</script></p><p><a href="javascript:alert(1)">坏链接</a></p><img src="https://example.com/a.png" onerror="bad()" alt="图"><form><input value="secret"></form></body></html>`, {
    authorization: { confirmed: true, basis: 'author-owned', reference: 'test-license' },
  })
  assert.equal(document.metadata.title, '授权标题')
  assert.equal(document.source.authorization.confirmed, true)
  assert.equal(document.source.authorization.reference, 'test-license')
  assert.match(document.html, /<h1>标题<\/h1>/)
  assert.match(document.html, /<strong>加粗<\/strong>/)
  assert.match(document.html, /<img src="https:\/\/example.com\/a.png" alt="图"/)
  assert.doesNotMatch(document.html, /script|style|onclick|onerror|javascript:|<form|<input/)
  assert.doesNotMatch(document.plainText, /alert|授权标题正文标题/)
  assert.ok(document.importWarnings.some(item => item.code === 'UNSAFE_LINK_URL'))
})

test('content inspection reports blockers and warnings without hiding import findings', () => {
  const { document } = importMarkdown('![](https://example.com/a.png)')
  const report = inspectContent(document)
  assert.equal(report.ready, false)
  assert.ok(report.blockers.some(item => item.code === 'TITLE_REQUIRED'))
  assert.ok(report.warnings.some(item => item.code === 'IMAGE_ALT_MISSING'))
  assert.throws(() => assertContentReady(document), error => error.code === 'CONTENT_INSPECTION_BLOCKED' && error.report.ready === false)
  const strict = inspectContent(document, { requireImageAlt: true })
  assert.ok(strict.blockers.some(item => item.code === 'IMAGE_ALT_MISSING'))
})

test('DOCX importer reads real ZIP/XML, core metadata, numbering, hyperlinks and embedded media', () => {
  const image = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3])
  const docx = makeDocx({ image })
  const { document, media, report } = importContent({ name: 'article.docx', data: docx })
  assert.equal(document.metadata.title, 'DOCX 标题')
  assert.equal(document.metadata.author, 'DOCX 作者')
  assert.equal(document.blocks[0].type, 'heading')
  assert.equal(document.blocks[0].level, 1)
  assert.ok(document.blocks.some(block => block.type === 'list' && block.ordered))
  assert.ok(document.blocks.some(block => block.type === 'table'))
  assert.equal(document.assets.length, 1)
  assert.equal(document.assets[0].mimeType, 'image/png')
  assert.match(document.assets[0].uri, /^asset:\/\/docx\/[a-f0-9]{64}$/)
  assert.deepEqual([...media[0].data], [...image])
  assert.deepEqual(document.links, ['https://example.com/docx'])
  assert.match(document.html, /rel="noopener noreferrer"/)
  assert.equal(report.ready, true)
  const repeated = importDocx(docx)
  assert.equal(repeated.document.contentHash, document.contentHash)
})

test('DOCX rejects damaged packages instead of returning partial content', () => {
  const docx = Buffer.from(makeDocx({ image: Uint8Array.from([1, 2, 3]) }))
  const marker = Buffer.from('word/document.xml')
  const offset = docx.indexOf(marker) + marker.length
  docx[offset] ^= 0xFF
  assert.throws(() => importDocx(docx), error => error instanceof ContentImportError && error.code === 'DOCX_ZIP_INVALID')
})

function makeDocx({ image }) {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'docProps/core.xml': `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:title>DOCX 标题</dc:title><dc:creator>DOCX 作者</dc:creator><dc:description>摘要</dc:description><cp:keywords>内容,DOCX</cp:keywords></cp:coreProperties>`,
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>DOCX 标题</w:t></w:r></w:p>
      <w:p><w:r><w:t>正文 </w:t></w:r><w:hyperlink r:id="rLink"><w:r><w:t>参考</w:t></w:r></w:hyperlink></w:p>
      <w:p><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>第一项</w:t></w:r></w:p>
      <w:p><w:r><w:drawing><a:blip r:embed="rImage"/></w:drawing></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>列 A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>列 B</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:sectPr/>
    </w:body></w:document>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rLink" Target="https://example.com/docx" TargetMode="External"/><Relationship Id="rImage" Target="media/image1.png"/></Relationships>`,
    'word/numbering.xml': `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="2"/></w:num></w:numbering>`,
    'word/media/image1.png': image,
  })
}

function zip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const original = Buffer.from(value)
    const compressed = deflateRawSync(original)
    const checksum = crc32(original)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(original.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    localParts.push(local, nameBytes, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(original.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBytes)
    offset += local.length + nameBytes.length + compressed.length
  }
  const centralStart = offset
  const central = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054B50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(centralStart, 16)
  return Buffer.concat([...localParts, central, eocd])
}
