const BLOCKED_SCHEMES = [
  'javascript:',
  'vbscript:',
  'data:',
  'file:',
  'filesystem:',
  'blob:',
];

export function classifyUrl(rawValue) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return { kind: 'empty', raw };
  // HTML entities are already decoded by parse5. Remove controls/whitespace so
  // obfuscated forms such as "java\nscript:" cannot bypass scheme checks.
  const normalized = raw.replace(/[\u0000-\u0020\u007f]+/gu, '').toLowerCase();
  if (BLOCKED_SCHEMES.some((scheme) => normalized.startsWith(scheme))) {
    return { kind: 'unsafe', raw, reason: 'blocked-scheme' };
  }

  if (normalized.startsWith('http:') || normalized.startsWith('https:') || raw.startsWith('//')) {
    try {
      const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
      const secure = parsed.protocol === 'https:' && normalized.startsWith('https:');
      return {
        kind: secure ? 'remote' : 'insecure',
        raw,
        host: parsed.hostname.toLowerCase(),
        url: parsed.href,
      };
    } catch {
      return { kind: 'unsafe', raw, reason: 'invalid-url' };
    }
  }

  if (/^[a-z][a-z0-9+.-]*:/u.test(normalized)) {
    return { kind: 'degraded', raw, reason: 'non-http-scheme' };
  }
  return { kind: 'local', raw };
}

export function srcsetUrls(value) {
  return String(value ?? '')
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/u)[0])
    .filter(Boolean);
}
