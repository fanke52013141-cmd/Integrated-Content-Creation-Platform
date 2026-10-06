const fs = require('fs');
const path = require('path');
const DIR = 'artifacts/ui-review';

function hue(c) {
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 18) return 'neutral';
  let h; if (mx === r) h = ((g - b) / (mx - mn)) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4;
  h = Math.round(h * 60 + 360) % 360;
  return h < 15 || h >= 345 ? 'red' : h < 45 ? 'orange' : h < 70 ? 'yellow' : h < 160 ? 'green' : h < 200 ? 'teal' : h < 255 ? 'blue' : h < 290 ? 'purple' : 'pink';
}

(async () => {
  const files = ['scripts/_out-03.json', 'scripts/_out-04.json', 'scripts/_out-05.json'];
  const report = [];
  for (const f of files) {
    if (!fs.existsSync(f)) { console.log('skip ' + f); continue; }
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    const s = o.outputComponents[0].design.screens[0];
    const tag = { '_out-03': '03-热点洞察', '_out-04': '04-账号定位', '_out-05': '05-文章排版' }[path.basename(f).replace('.json', '')];
    const shot = DIR + '/stitch-' + tag + '.png';
    const html = DIR + '/stitch-' + tag + '.html';
    fs.writeFileSync(shot, Buffer.from(await (await fetch(s.screenshot.downloadUrl)).arrayBuffer()));
    const ht = await (await fetch(s.htmlCode.downloadUrl)).text();
    fs.writeFileSync(html, ht, 'utf8');
    const cols = [...new Set([...ht.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))];
    const hs = {};
    cols.forEach((c) => { const n = hue(c); hs[n] = (hs[n] || 0) + 1; });
    const neutralPct = Math.round((hs.neutral || 0) / cols.length * 100);
    report.push({ id: s.id, title: s.title, shot, html, colors: cols.length, hues: hs, neutralPct });
  }
  fs.writeFileSync(DIR + '/stitch-screens.json', JSON.stringify(report, null, 2));
  console.log('屏幕'.padEnd(16) + '色值  中性占比  色相分布');
  report.forEach((r) => {
    console.log(r.title.padEnd(24) + String(r.colors).padStart(4) + '  ' + String(r.neutralPct + '%').padStart(6) + '  ' + JSON.stringify(r.hues));
  });
  console.log('\n合规检查（紫/粉/橙/青 应为 0）:');
  report.forEach((r) => {
    const bad = ['purple', 'pink', 'orange', 'teal'].filter((b) => r.hues[b]);
    console.log('  ' + r.title.padEnd(24) + (bad.length ? '⚠ ' + bad.join(',') + '（需核查是否语义色浅底）' : '✅ 通过'));
  });
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });