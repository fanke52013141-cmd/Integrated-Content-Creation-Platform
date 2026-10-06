const fs = require('fs');
const KEY = process.argv[2];
const PROJ = process.argv[3];
const METHOD = process.argv[4];          // 工具名
const ARGS_FILE = process.argv[5];        // 参数 JSON 文件
const OUT = process.argv[6];              // 输出 JSON（可选）

const URL = 'https://stitch.googleapis.com/mcp';
const H = { 'X-Goog-Api-Key': KEY, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

function parseSSE(text) {
  try { return JSON.parse(text); } catch (e) {
    const l = text.split('\n').filter((x) => x.startsWith('data:')).map((x) => x.slice(5).trim()).join('');
    if (l) return JSON.parse(l);
    throw new Error('unparseable: ' + text.slice(0, 300));
  }
}

async function main() {
  const args = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
  const r = await fetch(URL, {
    method: 'POST', headers: H,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: METHOD, arguments: args } })
  });
  const t = await r.text();
  if (!r.ok) { console.error('HTTP ' + r.status + ': ' + t.slice(0, 800)); process.exit(1); }
  const j = parseSSE(t);
  if (j.error) { console.error('RPC error: ' + JSON.stringify(j.error).slice(0, 800)); process.exit(1); }
  // 解一层内层 text
  let payload = j;
  try {
    const inner = j.result.content[0].text;
    payload = JSON.parse(inner);
  } catch (e) { /* 已是对象 */ }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload).slice(0, Number(process.env.MAXOUT || 1200)));
}
main().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });