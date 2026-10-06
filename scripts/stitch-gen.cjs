const fs = require('fs');
const KEY = process.argv[2];
const PROJ = process.argv[3];
const PROMPT_FILE = process.argv[4];
const URL = 'https://stitch.googleapis.com/mcp';
const H = { 'X-Goog-Api-Key': KEY, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

function parseSSE(text) {
  try { return JSON.parse(text); } catch (e) {
    const lines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (lines) return JSON.parse(lines);
    throw new Error('unparseable: ' + text.slice(0, 300));
  }
}

async function rpc(method, params, id) {
  const r = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const t = await r.text();
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + t.slice(0, 400));
  return parseSSE(t);
}

async function main() {
  const prompt = fs.readFileSync(PROMPT_FILE, 'utf8');
  const res = await rpc('tools/call', { name: 'generate_screen_from_text', arguments: { projectId: PROJ, prompt: prompt, deviceType: 'DESKTOP' } }, 1);
  const inner = JSON.parse(res.result.content[0].text);
  const d = inner.outputComponents[0].design;
  const s = d.screens[0];
  fs.writeFileSync(process.argv[5], JSON.stringify({
    shot: s.screenshot.downloadUrl, html: s.htmlCode.downloadUrl,
    id: s.id, title: s.title, width: s.width, height: s.height,
    designSystem: d.designSystem || inner.designSystemId || null
  }, null, 2));
  console.log('OK', s.id, s.title);
}
main().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });