import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function temporaryDirectory() {
  const runtime = path.join(PACKAGE_DIR, '.runtime');
  await mkdir(runtime, { recursive: true });
  return mkdtemp(path.join(runtime, 'test-'));
}

export function pngBytes() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
}

export function jpegBytes() {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32), Buffer.from([0xff, 0xd9])]);
}

export function makeInput(overrides = {}) {
  return {
    document: {
      id: 'document-1',
      markdown: '# Mock title\n\nMock body',
      metadata: {
        title: 'Mock title',
        author: 'Mock author',
        digest: 'Mock digest',
        content_source_url: '',
      },
      renderedHtml: '<h1>Mock title</h1><p>Mock body</p><img src="asset://image-1">',
      images: [{ id: 'image-1', src: 'asset://image-1', bytes: pngBytes() }],
      thumbnail: { id: 'cover', bytes: jpegBytes() },
      ...overrides.document,
    },
    theme: { id: 'default', options: {}, ...overrides.theme },
    account: { id: 'account-1', credentialRef: 'mock-account', ...overrides.account },
    renderer: { id: 'mock-renderer', version: '1.0.0', options: {}, ...overrides.renderer },
  };
}
