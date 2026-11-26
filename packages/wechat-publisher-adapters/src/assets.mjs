import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { replaceImageSource } from '../../wechat-publisher/src/content.mjs';
import { hashBytes, MemoryAssetCache } from './asset-cache.mjs';
import { validationError } from './errors.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'gif';
  return null;
}

function resolveInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw validationError(`Asset path escapes assetsRoot: ${candidate}`, 'ASSET_PATH_OUTSIDE_ROOT');
  }
  return resolved;
}

function allowedRemoteImage(reference, allowedHosts) {
  const candidate = reference?.src ?? reference?.url;
  if (!candidate) return null;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) return null;
  return url.href;
}

export async function resolveAsset(reference, { assetsRoot, kind, allowedRemoteHosts }) {
  if (!reference || typeof reference !== 'object') throw validationError(`${kind} reference is required.`, 'ASSET_REFERENCE_REQUIRED');
  if (kind === 'thumbnail' && reference.mediaId) return { mediaId: reference.mediaId };
  const remoteUrl = allowedRemoteImage(reference, allowedRemoteHosts);
  if (remoteUrl) return { remoteUrl };

  let bytes;
  let filename = reference.filename;
  const serializedBytes = reference.bytes?.$bytes ?? reference.buffer?.$bytes;
  if (reference.bytes instanceof Uint8Array || reference.buffer instanceof Uint8Array || serializedBytes) {
    bytes = reference.bytes instanceof Uint8Array || reference.buffer instanceof Uint8Array
      ? reference.bytes ?? reference.buffer
      : Buffer.from(serializedBytes, 'hex');
    filename ??= `${reference.id ?? kind}.${kind === 'thumbnail' ? 'jpg' : 'png'}`;
  } else {
    const candidate = reference.localSrc ?? reference.path ?? reference.src;
    if (!candidate) throw validationError(`${kind} requires bytes or a local path inside assetsRoot.`, 'ASSET_SOURCE_REQUIRED');
    if (/^[a-z][a-z0-9+.-]*:/iu.test(candidate) && !candidate.startsWith('asset://')) {
      throw validationError(`Remote asset fetching is disabled; upload a local authorized asset first: ${candidate}`, 'ASSET_REMOTE_FETCH_DISABLED');
    }
    if (!assetsRoot) throw validationError('assetsRoot is required for file-based asset references.', 'ASSET_ROOT_REQUIRED');
    const relative = candidate.startsWith('asset://') ? candidate.slice('asset://'.length).replace(/^\/+/u, '') : candidate;
    if (path.isAbsolute(relative)) throw validationError('Asset paths must be relative to assetsRoot.', 'ASSET_PATH_OUTSIDE_ROOT');
    const filePath = resolveInside(assetsRoot, relative);
    bytes = await readFile(filePath);
    filename ??= path.basename(filePath);
  }

  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw validationError(`${kind} is empty.`, 'ASSET_EMPTY');
  }
  const type = detectImageType(bytes);
  if (kind === 'image' && !['jpg', 'png'].includes(type)) {
    throw validationError(`Article images must be real JPG/PNG, detected ${type ?? 'unknown'}.`, 'ASSET_INVALID_TYPE');
  }
  if (kind === 'image' && bytes.length >= 1_000_000) {
    throw validationError('Article images must be smaller than 1,000,000 bytes.', 'ASSET_TOO_LARGE');
  }
  if (kind === 'thumbnail' && type !== 'jpg') {
    throw validationError('Thumbnail must be a real JPEG.', 'ASSET_INVALID_TYPE');
  }
  if (kind === 'thumbnail' && bytes.length > 64 * 1024) {
    throw validationError('Thumbnail must not exceed 64 KiB.', 'ASSET_TOO_LARGE');
  }
  return {
    bytes,
    filename,
    mimeType: type === 'png' ? 'image/png' : 'image/jpeg',
    hash: hashBytes(bytes),
  };
}

export function createWechatAssets({
  client,
  cache = new MemoryAssetCache(),
  assetsRoot,
  allowedRemoteHosts = ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn', 'res.wx.qq.com'],
}) {
  if (!client) throw new TypeError('A WeChat client is required');
  const allowed = new Set(allowedRemoteHosts.map((host) => host.toLowerCase()));
  return {
    idempotentUploads: true,

    async uploadImage(context) {
      const asset = await resolveAsset(context.image, { assetsRoot, kind: 'image', allowedRemoteHosts: allowed });
      if (asset.remoteUrl) return { url: asset.remoteUrl };
      return cache.getOrUpload({
        accountId: context.account.id,
        kind: 'image',
        hash: asset.hash,
        idempotencyKey: context.idempotencyKey,
        upload: () => client.uploadArticleImage(asset),
      });
    },

    async uploadThumbnail(context) {
      const asset = await resolveAsset(context.thumbnail, { assetsRoot, kind: 'thumbnail', allowedRemoteHosts: allowed });
      if (asset.mediaId) return { mediaId: asset.mediaId };
      if (asset.remoteUrl) throw validationError('Thumbnail requires upload to obtain mediaId.', 'THUMBNAIL_UPLOAD_REQUIRED');
      return cache.getOrUpload({
        accountId: context.account.id,
        kind: 'thumbnail',
        hash: asset.hash,
        idempotencyKey: context.idempotencyKey,
        upload: () => client.uploadThumbnail(asset),
      });
    },

    replaceImage(content, image, url) {
      return replaceImageSource(content, image, url);
    },
  };
}
