import { parseFragment } from 'parse5';
import { findCssUrls, hasFunction, parseInlineStyle } from './css.mjs';
import { getTargetPolicy, loadMatrix, resolveRule, validateMatrix } from './matrix.mjs';
import { classifyUrl, srcsetUrls } from './url.mjs';

function compact(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function positiveDataWidth(value) {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value.trim())) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function textValue(node) {
  return node.value ?? node.data ?? '';
}

export function lintHtml(html, options = {}) {
  if (typeof html !== 'string') throw new TypeError('html must be a string.');
  const matrix = options.matrix ? validateMatrix(options.matrix) : loadMatrix(options.matrixPath);
  const target = options.target ?? matrix.defaultTarget;
  getTargetPolicy(matrix, target);
  const document = parseFragment(html, { sourceCodeLocationInfo: true });
  const findings = [];
  const findingKeys = new Set();
  const nodePaths = new WeakMap();
  const allowedHosts = new Set(matrix.allowedImageHosts.map((host) => host.toLowerCase()));
  const nodeleafAllowedTags = new Set([
    ...matrix.nodeleafAllowedTags,
    ...(options.nodeleafAllowedTags ?? []),
  ].map((tag) => tag.toLowerCase()));
  let elementCount = 0;
  let imageCount = 0;

  function emit(ruleId, node, { evidence = '', attribute, detail } = {}) {
    const rule = resolveRule(matrix, ruleId, target);
    const source = node?.sourceCodeLocation;
    const location = {
      path: nodePaths.get(node) ?? '/',
      line: source?.startLine ?? null,
      column: source?.startCol ?? null,
      offset: source?.startOffset ?? null,
    };
    const key = [ruleId, location.offset, location.path, attribute, evidence].join('|');
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push({
      ruleId,
      category: rule.category,
      severity: rule.effectiveSeverity,
      action: rule.effectiveSeverity,
      target,
      officialCoverage: rule.officialCoverage,
      message: detail ? `${rule.message}: ${detail}` : rule.message,
      recommendation: rule.recommendation,
      evidence: compact(evidence),
      location: {
        ...location,
        tagName: node?.tagName ?? null,
        attribute: attribute ?? null,
      },
    });
  }

  function checkLink(raw, node, attribute) {
    const classification = classifyUrl(raw);
    if (classification.kind === 'unsafe') {
      emit('url.unsafe-scheme', node, { attribute, evidence: raw, detail: classification.reason });
    } else if (classification.kind === 'insecure' || classification.kind === 'degraded') {
      emit('url.degraded-scheme', node, { attribute, evidence: raw });
    }
  }

  function checkImageUrl(raw, node, attribute) {
    const classification = classifyUrl(raw);
    switch (classification.kind) {
      case 'empty':
        emit('image.source-required', node, { attribute, evidence: raw });
        break;
      case 'unsafe':
        emit('url.unsafe-scheme', node, { attribute, evidence: raw, detail: classification.reason });
        break;
      case 'local':
        emit('image.nonremote', node, { attribute, evidence: raw });
        break;
      case 'insecure':
        emit('image.insecure', node, { attribute, evidence: raw });
        break;
      case 'degraded':
        emit('url.unsafe-scheme', node, { attribute, evidence: raw, detail: classification.reason });
        break;
      case 'remote':
        if (!allowedHosts.has(classification.host)) {
          emit('image.external-host', node, { attribute, evidence: raw, detail: classification.host });
        }
        break;
      default:
        throw new Error(`Unknown URL classification: ${classification.kind}`);
    }
  }

  function checkStyle(style, node) {
    if (/@(?:import|keyframes|font-face|supports|media)\b/iu.test(style)) {
      emit('css.dangerous', node, { attribute: 'style', evidence: style });
    }
    for (const declaration of parseInlineStyle(style)) {
      const { property, value, raw } = declaration;
      const normalizedValue = value.toLowerCase();
      const evidence = raw || style;
      if (property.startsWith('--') || hasFunction(value, 'var')) {
        emit('css.variable', node, { attribute: `style:${property || '?'}`, evidence });
      }
      if (property === 'position' && /^(?:absolute|fixed|sticky)\b/u.test(normalizedValue)) {
        emit('css.position', node, { attribute: 'style:position', evidence });
      }
      if ((property === 'display' && /^(?:inline-)?grid\b/u.test(normalizedValue))
        || (property === 'float' && !/^none\b/u.test(normalizedValue))) {
        emit('css.layout', node, { attribute: `style:${property}`, evidence });
      }
      if (property.startsWith('animation') || property.startsWith('transition') || property === 'scroll-behavior') {
        emit('css.animation', node, { attribute: `style:${property}`, evidence });
      }
      if (property === 'behavior' || property === '-moz-binding' || hasFunction(value, 'expression')) {
        emit('css.dangerous', node, { attribute: `style:${property || '?'}`, evidence });
      }
      if (['color-mix', 'oklch', 'oklab', 'lab', 'lch'].some((name) => hasFunction(value, name))) {
        emit('css.modern-function', node, { attribute: `style:${property || '?'}`, evidence });
      }
      if (property === 'font-family') {
        emit('css.font-family', node, { attribute: 'style:font-family', evidence });
      }
      for (const url of findCssUrls(value)) {
        if (!url.startsWith('#')) checkImageUrl(url, node, `style:${property || '?'}.url`);
      }
    }
  }

  function checkLeaf(node) {
    function visitDescendants(parent) {
      for (const child of parent.childNodes ?? []) {
        if (child.tagName && matrix.blockLevelTags.includes(child.tagName.toLowerCase())) {
          emit('structure.leaf-block', child, { evidence: `<${child.tagName}> inside <span leaf>` });
        }
        visitDescendants(child);
      }
    }
    visitDescendants(node);
  }

  function checkNodeleaf(node) {
    for (const child of node.childNodes ?? []) {
      if (child.tagName) {
        const tag = child.tagName.toLowerCase();
        if (!nodeleafAllowedTags.has(tag)) {
          emit('structure.nodeleaf-content', child, { evidence: `<${tag}> inside <section nodeleaf>` });
        }
      } else if (child.nodeName === '#text' && textValue(child).trim()) {
        emit('structure.nodeleaf-content', child, { evidence: textValue(child) });
      }
    }
  }

  function checkImage(node, attrs) {
    imageCount += 1;
    const sources = ['src', 'data-src', 'data-original']
      .filter((name) => Object.hasOwn(attrs, name))
      .map((name) => ({ name, value: attrs[name] }));
    if (!sources.some(({ value }) => String(value).trim())) {
      emit('image.source-required', node, { attribute: 'src', evidence: '<img> without src/data-src' });
    }
    for (const source of sources) checkImageUrl(source.value, node, source.name);
    for (const name of ['srcset', 'imagesrcset']) {
      if (Object.hasOwn(attrs, name)) {
        for (const url of srcsetUrls(attrs[name])) checkImageUrl(url, node, name);
      }
    }
    if (!positiveDataWidth(attrs['data-w'])) {
      emit('image.data-w', node, {
        attribute: 'data-w',
        evidence: Object.hasOwn(attrs, 'data-w') ? attrs['data-w'] : '(missing)',
      });
    }
  }

  function indexDescendants(node, path) {
    nodePaths.set(node, path);
    let elementIndex = 0;
    for (const child of node.childNodes ?? []) {
      if (!child.tagName) continue;
      indexDescendants(child, `${path}/${child.tagName.toLowerCase()}[${elementIndex}]`);
      elementIndex += 1;
    }
  }

  function visit(node, path) {
    const tag = node.tagName.toLowerCase();
    elementCount += 1;
    nodePaths.set(node, path);
    if (matrix.dangerousTags.includes(tag)) {
      emit('html.dangerous-tag', node, { evidence: `<${tag}>` });
    }
    const attrs = {};
    for (const attr of node.attrs ?? []) attrs[attr.name.toLowerCase()] = attr.value;

    for (const attr of node.attrs ?? []) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on')) {
        emit('html.event-handler-attribute', node, { attribute: name, evidence: `${name}=${value}` });
      }
      if (matrix.dangerousAttributes.includes(name)) {
        emit('html.dangerous-attribute', node, { attribute: name, evidence: `${name}=${value}` });
      }
      const urlType = matrix.urlAttributes[name];
      if (urlType === 'link') {
        if (tag === 'image' && name === 'href') checkImageUrl(value, node, name);
        else checkLink(value, node, name);
      } else if (urlType === 'image' && tag !== 'img') {
        checkImageUrl(value, node, name);
      } else if (urlType === 'srcset' && tag !== 'img') {
        for (const url of srcsetUrls(value)) checkImageUrl(url, node, name);
      }
      if (name === 'style') checkStyle(value, node);
    }

    if (tag === 'img') checkImage(node, attrs);
    if (tag === 'span' && Object.hasOwn(attrs, 'leaf')) checkLeaf(node);
    if (tag === 'section' && Object.hasOwn(attrs, 'nodeleaf')) checkNodeleaf(node);

    let elementIndex = 0;
    for (const child of node.childNodes ?? []) {
      if (!child.tagName) continue;
      visit(child, `${path}/${child.tagName.toLowerCase()}[${elementIndex}]`);
      elementIndex += 1;
    }
  }

  let rootElementIndex = 0;
  for (const child of document.childNodes ?? []) {
    if (!child.tagName) continue;
    const rootPath = `/${child.tagName.toLowerCase()}[${rootElementIndex}]`;
    indexDescendants(child, rootPath);
    visit(child, rootPath);
    rootElementIndex += 1;
  }

  findings.sort((left, right) => {
    const offsetDifference = (left.location.offset ?? Number.MAX_SAFE_INTEGER)
      - (right.location.offset ?? Number.MAX_SAFE_INTEGER);
    return offsetDifference
      || left.location.path.localeCompare(right.location.path)
      || left.ruleId.localeCompare(right.ruleId)
      || left.location.attribute?.localeCompare(right.location.attribute ?? '') || 0
      || left.evidence.localeCompare(right.evidence);
  });

  const blockers = findings.filter((finding) => finding.severity === 'block');
  const degrades = findings.filter((finding) => finding.severity === 'degrade');
  const ruleHits = {};
  for (const finding of findings) ruleHits[finding.ruleId] = (ruleHits[finding.ruleId] ?? 0) + 1;
  const status = blockers.length ? 'block' : degrades.length ? 'degrade' : 'pass';
  return {
    schemaVersion: 1,
    matrixVersion: matrix.matrixVersion,
    target,
    source: options.source ?? null,
    status,
    valid: blockers.length === 0,
    recommendedAction: blockers.length
      ? 'fix-blockers-before-delivery'
      : degrades.length
        ? 'review-degradations'
        : 'none',
    summary: {
      elements: elementCount,
      images: imageCount,
      findings: findings.length,
      blockers: blockers.length,
      degrades: degrades.length,
      ruleHits,
    },
    officialCheckerGaps: matrix.officialCheckerGaps,
    findings,
  };
}
