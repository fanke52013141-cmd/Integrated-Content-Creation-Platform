function stripComments(input) {
  let output = '';
  let quote = null;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quote) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = input.indexOf('*/', index + 2);
      index = end < 0 ? input.length : end + 1;
      output += ' ';
      continue;
    }
    output += char;
  }
  return output;
}

function splitTopLevel(input, delimiter) {
  const parts = [];
  let current = '';
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      current += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '(') {
      depth += 1;
      current += char;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (char === delimiter && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function colonIndex(input) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ':' && depth === 0) return index;
  }
  return -1;
}

export function parseInlineStyle(style) {
  return splitTopLevel(stripComments(String(style ?? '')), ';')
    .map((raw) => {
      const colon = colonIndex(raw);
      if (colon < 0) return { raw: raw.trim(), property: '', value: '' };
      return {
        raw: raw.trim(),
        property: raw.slice(0, colon).trim().toLowerCase(),
        value: raw.slice(colon + 1).trim(),
      };
    })
    .filter((declaration) => declaration.raw);
}

export function findCssUrls(value) {
  const urls = [];
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/giu;
  for (const match of String(value ?? '').matchAll(pattern)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (url) urls.push(url);
  }
  return urls;
}

export function hasFunction(value, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9_-])${escaped}\\s*\\(`, 'iu').test(value);
}
