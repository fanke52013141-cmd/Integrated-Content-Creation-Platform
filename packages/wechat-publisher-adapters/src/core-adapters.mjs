import { parseFragment } from 'parse5';
import { classifyError, validationError } from './errors.mjs';

function characters(value = '') {
  return Array.from(value).length;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/gu, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
}

function parsedImages(html) {
  const document = parseFragment(html);
  const images = [];
  walk(document, (node) => {
    if (node.tagName !== 'img') return;
    const attrs = Object.fromEntries((node.attrs ?? []).map((attr) => [attr.name.toLowerCase(), attr.value]));
    const index = images.length + 1;
    images.push({
      id: attrs['data-asset-id'] ?? `img-${index}`,
      ...(attrs.src ? { src: attrs.src } : {}),
      ...(attrs['data-local-src'] ? { localSrc: attrs['data-local-src'] } : {}),
      ...(attrs['data-w'] ? { dataW: attrs['data-w'] } : {}),
    });
  });
  return images;
}

function normalizedHtml(html) {
  const document = parseFragment(String(html ?? ''));
  const text = [];
  const tags = {};
  const images = [];
  walk(document, (node) => {
    if (node.nodeName === '#text') text.push(textValue(node));
    if (!node.tagName) return;
    const tag = node.tagName.toLowerCase();
    tags[tag] = (tags[tag] ?? 0) + 1;
    if (tag === 'img') {
      const src = node.attrs?.find((attr) => attr.name === 'src')?.value;
      if (src) images.push(src);
    }
  });
  return {
    text: text.join(' ').replace(/\s+/gu, ' ').trim(),
    tags,
    images: images.sort(),
  };
}

function textValue(node) {
  return node.value ?? node.data ?? '';
}

function firstDifference(left, right) {
  const a = [...left];
  const b = [...right];
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return index;
  return a.length === b.length ? -1 : length;
}

export function createRendererAdapter({ render } = {}) {
  return {
    async render(context) {
      if (typeof render === 'function') {
        const output = await render(context);
        if (typeof output?.html !== 'string') throw validationError('Renderer must return { html }.', 'RENDER_INVALID_RESPONSE');
        return output;
      }
      if (typeof context.document.renderedHtml === 'string') {
        return { html: context.document.renderedHtml, plainText: context.document.markdown };
      }
      throw validationError('No renderer implementation or document.renderedHtml was provided.', 'RENDERER_UNAVAILABLE');
    },
  };
}

export function createMockRenderer() {
  return createRendererAdapter({
    render: async (context) => ({
      html: context.document.renderedHtml
        ?? `<h1>${escapeHtml(context.document.metadata?.title)}</h1><p>${escapeHtml(context.document.markdown)}</p>`,
      plainText: context.document.markdown,
    }),
  });
}

export function createInspectorAdapter({ inspect, lint } = {}) {
  return {
    async inspect(context) {
      if (typeof inspect === 'function') return inspect(context);
      const { document, rendered } = context;
      const metadata = document.metadata ?? {};
      const blockers = [];
      const warnings = [];
      const addBlocker = (code, message, extra = {}) => blockers.push({ code, message, ...extra });
      if (!metadata.title?.trim()) addBlocker('TITLE_REQUIRED', 'Title is required');
      if (characters(metadata.title) > 32) addBlocker('TITLE_TOO_LONG', 'Title exceeds 32 characters');
      if (characters(metadata.author) > 16) addBlocker('AUTHOR_TOO_LONG', 'Author exceeds 16 characters');
      if (characters(metadata.digest) > 120) addBlocker('DIGEST_TOO_LONG', 'Digest exceeds 120 characters');
      if (!rendered.html?.trim()) addBlocker('CONTENT_REQUIRED', 'Rendered HTML is required');
      if (characters(rendered.html) >= 20_000) addBlocker('CONTENT_TOO_LONG', 'Rendered HTML has 20,000+ characters');
      if (Buffer.byteLength(rendered.html) >= 1_000_000) addBlocker('CONTENT_BYTES_TOO_LARGE', 'Rendered HTML is 1MB+');

      const discovered = parsedImages(rendered.html ?? '');
      const supplied = new Map((document.images ?? []).map((image) => [image.id, image]));
      const suppliedBySrc = new Map((document.images ?? []).filter((image) => image.src).map((image) => [image.src, image]));
      const images = discovered.map((image) => ({
        ...image,
        ...(supplied.get(image.id) ?? suppliedBySrc.get(image.src) ?? {}),
      }));
      for (const image of document.images ?? []) {
        if (!discovered.some((candidate) => candidate.id === image.id || (image.src && candidate.src === image.src))) {
          images.push(image);
        }
      }
      const thumbnail = document.thumbnail
        ?? metadata.thumbnail
        ?? (metadata.thumb ? { id: 'cover', src: metadata.thumb } : null);
      if (!thumbnail) addBlocker('COVER_REQUIRED', 'A configured thumbnail is required');

      if (typeof lint === 'function') {
        const quality = await lint(rendered.html, { target: 'editor-paste' });
        for (const finding of quality.findings ?? []) {
          const target = finding.severity === 'block' ? blockers : warnings;
          target.push({
            code: finding.ruleId,
            message: finding.message,
            recommendation: finding.recommendation,
            location: finding.location,
          });
        }
      }

      return {
        ready: blockers.length === 0,
        blockers,
        warnings,
        article: {
          title: metadata.title ?? '',
          author: metadata.author ?? '',
          digest: metadata.digest ?? '',
          content_source_url: metadata.content_source_url ?? '',
          content: rendered.html,
          need_open_comment: metadata.need_open_comment ?? 0,
          only_fans_can_comment: metadata.only_fans_can_comment ?? 0,
        },
        images,
        thumbnail,
        counts: {
          title: characters(metadata.title),
          author: characters(metadata.author),
          digest: characters(metadata.digest),
          contentCharacters: characters(rendered.html),
          contentUtf8Bytes: Buffer.byteLength(rendered.html ?? ''),
          images: images.length,
        },
      };
    },
  };
}

export function compareDraftArticles(expected, actual) {
  const source = normalizedHtml(expected.content);
  const readback = normalizedHtml(actual.content);
  const differences = [];
  for (const field of ['title', 'author', 'digest', 'content_source_url', 'thumb_media_id', 'need_open_comment', 'only_fans_can_comment']) {
    if ((expected[field] ?? '') !== (actual[field] ?? '')) {
      differences.push({ field, expected: expected[field], actual: actual[field] });
    }
  }
  const semanticTextEqual = source.text === readback.text;
  if (!semanticTextEqual) differences.push({ field: 'content.semanticText' });
  const imagesEqual = JSON.stringify(source.images) === JSON.stringify(readback.images);
  if (!imagesEqual) {
    differences.push({ field: 'content.images', expected: source.images, actual: readback.images });
  }
  const difference = firstDifference(source.text, readback.text);
  return {
    ok: differences.length === 0,
    semanticTextEqual,
    imagesEqual,
    structuralEqual: JSON.stringify(source.tags) === JSON.stringify(readback.tags),
    differences,
    firstDifference: difference,
    sourceTextCharacters: source.text.length,
    readbackTextCharacters: readback.text.length,
    sourcePreview: difference >= 0 ? source.text.slice(Math.max(0, difference - 60), difference + 100) : '',
    readbackPreview: difference >= 0 ? readback.text.slice(Math.max(0, difference - 60), difference + 100) : '',
    sourceImageCount: source.images.length,
    readbackImageCount: readback.images.length,
  };
}

export function createVerifierAdapter() {
  return {
    async compare({ expected, actual }) {
      return compareDraftArticles(expected, actual);
    },
  };
}

export async function checkAccountHealth({ client, account = { id: 'default' } }) {
  try {
    const report = await client.healthCheck();
    return {
      ok: true,
      accountId: account.id,
      checkedAt: new Date().toISOString(),
      ...report,
    };
  } catch (error) {
    const failure = classifyError(error);
    return {
      ok: false,
      accountId: account.id,
      checkedAt: new Date().toISOString(),
      error: {
        code: failure.code,
        category: failure.category,
        retryable: failure.retryable,
        message: failure.message,
        status: failure.status,
      },
    };
  }
}
