import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyUrl,
  DEFAULT_MATRIX_PATH,
  getTargetPolicy,
  loadMatrix,
  parseInlineStyle,
  resolveRule,
  SUPPORTED_TARGETS,
  validateMatrix,
} from '../index.mjs';

test('matrix is versioned and covers the declared official gaps', () => {
  const matrix = loadMatrix();
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.matrixVersion, '1.0.0');
  assert.ok(matrix.rules.length >= 19);
  assert.deepEqual(SUPPORTED_TARGETS, ['preview', 'editor-paste', 'draft']);
  assert.equal(getTargetPolicy(matrix, 'draft').externalImageSeverity, 'block');
  assert.equal(resolveRule(matrix, 'image.external-host', 'draft').effectiveSeverity, 'block');
  assert.equal(resolveRule(matrix, 'image.external-host', 'editor-paste').effectiveSeverity, 'degrade');

  const gaps = Object.fromEntries(matrix.officialCheckerGaps.map((gap) => [gap.id, gap]));
  assert.equal(gaps['spec-chapter-3-fonts'].status, 'implemented-as-degrade');
  assert.deepEqual(gaps['spec-2.2-span-leaf'].ruleIds, ['structure.leaf-block']);
  assert.deepEqual(gaps['spec-2.3-section-nodeleaf'].ruleIds, ['structure.nodeleaf-content']);
  assert.equal(gaps['redundant-node'].status, 'deferred');
  assert.ok(DEFAULT_MATRIX_PATH.endsWith('compatibility-v1.json'));
});

test('matrix validation rejects duplicate rules and invalid targets', () => {
  const matrix = loadMatrix();
  const duplicate = structuredClone(matrix);
  duplicate.rules.push(duplicate.rules[0]);
  assert.throws(() => validateMatrix(duplicate), /Duplicate or missing rule id/u);
  assert.throws(() => getTargetPolicy(matrix, 'production'), /Unknown target/u);

  const badGap = structuredClone(matrix);
  badGap.officialCheckerGaps[0].ruleIds = ['not-implemented'];
  assert.throws(() => validateMatrix(badGap), /references unknown rule/u);
});

test('URL classification treats only explicit HTTPS as secure remote input', () => {
  assert.equal(classifyUrl('https://mmbiz.qpic.cn/a.png').kind, 'remote');
  assert.equal(classifyUrl('http://mmbiz.qpic.cn/a.png').kind, 'insecure');
  assert.equal(classifyUrl('//mmbiz.qpic.cn/a.png').kind, 'insecure');
  assert.equal(classifyUrl('java\nscript:alert(1)').kind, 'unsafe');
  assert.equal(classifyUrl('assets/image.png').kind, 'local');
  assert.equal(classifyUrl('#footnote').kind, 'local');
});

test('inline CSS parser respects quoted strings and parentheses', () => {
  const declarations = parseInlineStyle("color:red; background-image:url(\"data:image/png;base64,abc\"); font-family:'A;B'; width:calc(100% - 1px)");
  assert.equal(declarations.length, 4);
  assert.equal(declarations[0].property, 'color');
  assert.equal(declarations[1].property, 'background-image');
  assert.match(declarations[1].value, /base64,abc/u);
  assert.equal(declarations[2].property, 'font-family');
  assert.equal(declarations[3].value, 'calc(100% - 1px)');
});
