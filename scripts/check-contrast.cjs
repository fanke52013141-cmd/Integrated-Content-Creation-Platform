// 直接从 tokens.css 解析当前令牌值，计算 WCAG 对比度。
// 目的：验证改动没有回退既有的 AA 达标线。
//
// 为什么不用 ux-audit-tokens.mjs：那个脚本内部硬编码了候选色值做对比，
// 不读 tokens.css，输出的是历史数据（例如 --warning #ff9500，而当前值已是 #b25000），
// 不能作为当前状态的判据。本脚本直接读真实令牌。
//
// 用法：node scripts/check-contrast.cjs（可在任意 cwd 下执行）
const fs = require('fs');
const path = require('path');

// 以脚本自身位置定位仓库根，避免依赖 cwd
const ROOT = path.resolve(__dirname, '..');
const TOKENS = path.join(ROOT, 'src/renderer/src/styles/tokens.css');

function parse(file) {
  const text = fs.readFileSync(file, 'utf8');
  const root = text.split(':root[data-theme="dark"]');
  const grab = (chunk) => {
    const out = {};
    const re = /(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g;
    let m;
    while ((m = re.exec(chunk))) out[m[1]] = m[2];
    return out;
  };
  return { light: grab(root[0]), dark: grab(root[1] || '') };
}

function hex(c) {
  let s = c.replace('#', '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function lum(rgb) {
  const a = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function ratio(fg, bg) {
  const a = lum(hex(fg)), b = lum(hex(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const { light, dark } = parse(TOKENS);
const rows = [];
// 承载信息的文字令牌：必须 ≥ 4.5:1
const TEXT = ['--text', '--text-primary', '--text-secondary', '--text-tertiary', '--success', '--warning', '--danger', '--primary'];
const LIGHT_BG = ['--background', '--surface-solid'];
const DARK_BG = ['--background', '--surface-solid'];

function check(mode, tokens, bgs) {
  bgs.forEach((bg) => {
    TEXT.forEach((tk) => {
      if (!tokens[tk] || !tokens[bg]) return;
      const r = ratio(tokens[tk], tokens[bg]);
      rows.push({
        mode: mode,
        token: tk,
        bg: bg,
        ratio: r,
        pass: r >= 4.5,
        warn: r >= 3 && r < 4.5
      });
    });
  });
}
check('亮色', light, LIGHT_BG);
check('暗色', dark, DARK_BG);

let fail = 0, warn = 0;
rows.forEach((r) => {
  const mark = r.pass ? '✓' : r.warn ? '△' : '✗';
  if (!r.pass && !r.warn) fail++;
  if (r.warn) warn++;
  console.log(`${mark} ${r.mode}  ${r.token.padEnd(20)} on ${r.bg.padEnd(18)} ${r.ratio.toFixed(2)}:1`);
});
console.log('\n────────────────────────────────');
console.log(`不达标（<3:1，必须修）：${fail}    仅大字可用（3–4.5:1）：${warn}    总计：${rows.length}`);
if (fail > 0) process.exit(1);