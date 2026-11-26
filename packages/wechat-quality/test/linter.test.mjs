import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { lintHtml } from '../index.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const ids = (report) => [...new Set(report.findings.map((finding) => finding.ruleId))];
const has = (report, ruleId, severity) => report.findings.some((finding) => (
  finding.ruleId === ruleId && (!severity || finding.severity === severity)
));

test('valid draft fixture passes with zero findings', () => {
  const report = lintHtml(fixture('valid-draft.html'), { target: 'draft' });
  assert.equal(report.matrixVersion, '1.0.0');
  assert.equal(report.status, 'pass');
  assert.equal(report.valid, true);
  assert.equal(report.summary.findings, 0);
  assert.equal(report.recommendedAction, 'none');
});

test('preview degradations stay non-blocking and actionable', () => {
  const report = lintHtml(fixture('valid-preview.html'), { target: 'preview' });
  assert.equal(report.status, 'degrade');
  assert.equal(report.valid, true);
  assert.equal(report.summary.blockers, 0);
  assert.equal(report.summary.degrades, 4);
  for (const ruleId of ['css.font-family', 'url.degraded-scheme', 'image.nonremote', 'image.external-host']) {
    assert.ok(has(report, ruleId, 'degrade'), ruleId);
  }
});

test('dangerous tags are blocked independently', async (t) => {
  for (const tag of ['script', 'iframe', 'object', 'style', 'form', 'button']) {
    await t.test(tag, () => {
      const report = lintHtml(`<${tag}>x</${tag}>`);
      assert.equal(report.valid, false);
      assert.ok(has(report, 'html.dangerous-tag', 'block'));
    });
  }
});

test('event handlers, srcdoc, and formaction are blocked', () => {
  const report = lintHtml('<p onclick="x()" srcdoc="bad" formaction="https://example.com">x</p>');
  assert.ok(has(report, 'html.event-handler-attribute', 'block'));
  assert.ok(has(report, 'html.dangerous-attribute', 'block'));
  assert.equal(report.summary['blockers'] >= 3, true);
});

test('unsafe and obfuscated URL schemes are blocked', () => {
  const report = lintHtml(`<a href="java&#10;script:alert(1)">x</a><a href="file:///etc/passwd">f</a><a href="data:text/html;base64,PGI+">d</a>`);
  assert.equal(report.findings.filter((finding) => finding.ruleId === 'url.unsafe-scheme').length, 3);
  assert.equal(report.valid, false);
});

test('HTTPS links, anchors, and relative citations do not trigger unsafe URL', () => {
  const report = lintHtml('<a href="https://example.com">x</a><a href="#fn-1">note</a><a href="./references.html">refs</a>');
  assert.equal(has(report, 'url.unsafe-scheme'), false);
  assert.equal(has(report, 'url.degraded-scheme'), false);
});

test('CSS disabled constructs map to their dedicated rules', () => {
  const report = lintHtml(`<section style="--x:1px; width:var(--x); position:fixed; display:inline-grid; float:right; animation:fade 1s; transition:all .2s; behavior:url(x.htc); color:expression(alert(1))">x</section>`);
  for (const ruleId of ['css.variable', 'css.position', 'css.layout', 'css.animation', 'css.dangerous']) {
    assert.ok(has(report, ruleId, 'block'), ruleId);
  }
  assert.equal(report.valid, false);
});

test('safe flow CSS and fragment-only url() do not produce blockers', () => {
  const report = lintHtml('<section style="position:relative; display:flex; float:none; background:url(#g)">x</section>');
  assert.equal(report.status, 'pass');
});

test('font-family and modern color functions degrade rather than block', () => {
  const report = lintHtml('<p style="font-family:Roboto; color:color-mix(in srgb, red 20%, blue); background:oklch(0.7 0.1 30)">x</p>');
  assert.ok(has(report, 'css.font-family', 'degrade'));
  assert.ok(has(report, 'css.modern-function', 'degrade'));
  assert.equal(report.status, 'degrade');
  assert.equal(report.valid, true);
});

test('span[leaf] accepts inline content but rejects block descendants', () => {
  const valid = lintHtml('<span leaf="">text<strong>bold</strong><em>em</em><br><img src="https://mmbiz.qpic.cn/a.png" data-w="20"></span>', { target: 'draft' });
  assert.equal(valid.status, 'pass');
  for (const tag of ['div', 'section', 'p', 'table']) {
    const report = lintHtml(`<span leaf="">text<${tag}>block</${tag}></span>`);
    assert.ok(has(report, 'structure.leaf-block', 'block'), tag);
  }
});

test('section[nodeleaf] defaults to img only and supports explicit verified components', () => {
  const valid = lintHtml('<section nodeleaf=""><img src="https://mmbiz.qpic.cn/a.png" data-w="20"></section>', { target: 'draft' });
  assert.equal(valid.status, 'pass');
  const invalid = lintHtml('<section nodeleaf=""><mp-card></mp-card>text</section>');
  assert.ok(has(invalid, 'structure.nodeleaf-content', 'block'));
  const allowed = lintHtml('<section nodeleaf=""><mp-card></mp-card></section>', { nodeleafAllowedTags: ['mp-card'] });
  assert.equal(has(allowed, 'structure.nodeleaf-content'), false);
});

test('data-w accepts only finite positive decimal intrinsic widths', () => {
  for (const value of ['1', '1080', '0.5', '.5']) {
    const report = lintHtml(`<img src="https://mmbiz.qpic.cn/a.png" data-w="${value}">`, { target: 'draft' });
    assert.equal(has(report, 'image.data-w'), false, value);
  }
  for (const value of ['0', '-1', 'NaN', 'Infinity', '12px', '0x10', '']) {
    const report = lintHtml(`<img src="https://mmbiz.qpic.cn/a.png" data-w="${value}">`, { target: 'draft' });
    assert.ok(has(report, 'image.data-w', 'degrade'), value || '(empty)');
  }
  const missing = lintHtml('<img src="https://mmbiz.qpic.cn/a.png">', { target: 'draft' });
  assert.ok(has(missing, 'image.data-w', 'degrade'));
});

test('draft blocks local, arbitrary external, HTTP, and protocol-relative images', () => {
  const cases = [
    ['assets/local.png', 'image.nonremote'],
    ['https://example.com/a.png', 'image.external-host'],
    ['http://mmbiz.qpic.cn/a.png', 'image.insecure'],
    ['//mmbiz.qpic.cn/a.png', 'image.insecure'],
  ];
  for (const [src, ruleId] of cases) {
    const report = lintHtml(`<img src="${src}" data-w="100">`, { target: 'draft' });
    assert.equal(report.valid, false, src);
    assert.ok(has(report, ruleId, 'block'), `${src} -> ${ruleId}`);
  }
});

test('editor-paste reports arbitrary external images as non-blocking degradation', () => {
  const report = lintHtml('<img src="https://example.com/a.png" data-w="100">', { target: 'editor-paste' });
  assert.ok(has(report, 'image.external-host', 'degrade'));
  assert.equal(report.status, 'degrade');
  assert.equal(report.valid, true);
});

test('image source is required; data-src is accepted as a fallback source', () => {
  const missing = lintHtml('<img data-w="100">', { target: 'draft' });
  assert.ok(has(missing, 'image.source-required', 'block'));
  const fallback = lintHtml('<img data-src="https://mmbiz.qpic.cn/a.png" data-w="100">', { target: 'draft' });
  assert.equal(has(fallback, 'image.source-required'), false);
  assert.equal(fallback.status, 'pass');
});

test('CSS url() and srcset cannot bypass image host and scheme checks', () => {
  const report = lintHtml(`<section style="background:url('https://example.com/bg.png'); mask:url('file:///tmp/x.svg')"><img src="https://mmbiz.qpic.cn/a.png" srcset="https://example.com/a2.png 2x" data-w="100"></section>`, { target: 'draft' });
  assert.ok(has(report, 'image.external-host', 'block'));
  assert.ok(has(report, 'url.unsafe-scheme', 'block'));
  assert.ok(report.findings.some((finding) => finding.location.attribute === 'srcset'));
});

test('comprehensive invalid fixture reports all major rule families with locations', () => {
  const report = lintHtml(fixture('invalid-comprehensive.html'), { target: 'draft', source: 'invalid-comprehensive.html' });
  const expected = [
    'html.dangerous-tag',
    'html.event-handler-attribute',
    'html.dangerous-attribute',
    'url.unsafe-scheme',
    'css.variable',
    'css.position',
    'css.layout',
    'css.animation',
    'css.font-family',
    'css.modern-function',
    'structure.leaf-block',
    'structure.nodeleaf-content',
    'image.data-w',
    'image.source-required',
    'image.nonremote',
    'image.insecure',
    'image.external-host',
  ];
  for (const ruleId of expected) assert.ok(ids(report).includes(ruleId), ruleId);
  assert.equal(report.status, 'block');
  assert.equal(report.valid, false);
  assert.ok(report.summary.blockers > 0);
  assert.ok(report.findings.every((finding) => finding.location.path));
  assert.ok(report.findings.some((finding) => finding.location.line > 0));
});

test('reports are deterministic and carry matrix/gap metadata', () => {
  const html = fixture('invalid-comprehensive.html');
  const first = lintHtml(html, { target: 'draft' });
  const second = lintHtml(html, { target: 'draft' });
  assert.deepEqual(first, second);
  assert.equal(first.matrixVersion, '1.0.0');
  assert.equal(first.officialCheckerGaps.length, 4);
  assert.ok(first.findings.every((finding) => finding.recommendation));
});
