import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { electron } from './lib/electron-test.mjs'

// Read configuration only. Never copy user content or decrypt secrets in Node.
const root = await mkdtemp(resolve(tmpdir(), 'moliu-live-configured-'))
const report = { at: new Date().toISOString(), checks: [], skipped: ['真实生图：此脚本不覆盖', '公众号真实推送：此脚本不覆盖'] }
let app
async function check(name, run) {
  try { const details = await run(); report.checks.push({ name, passed: true, details }); console.log(`${name}: PASS`); return details }
  catch (error) { report.checks.push({ name, passed: false, error: String(error.message).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 600) }); console.log(`${name}: FAIL`); return null }
}
try {
  await mkdir(resolve('artifacts'), { recursive: true })
  const bundle = resolve('artifacts/live-configured-backend.mjs')
  await build({ stdin: { contents: "export { AppDatabase } from './src/main/database.ts'", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle })
  const { AppDatabase } = await import(pathToFileURL(bundle).href)
  const target = new AppDatabase(resolve(root, 'moliu.db'))
  const sourcePath = process.env.MOLIU_LIVE_SOURCE_DB || resolve(process.env.APPDATA, 'moliu-desktop/moliu.db')
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    for (const row of source.prepare('SELECT p.*, s.encrypted_key FROM providers p JOIN provider_secrets s ON s.provider_id=p.id WHERE p.enabled=1').all()) {
      const models = source.prepare('SELECT * FROM provider_models WHERE provider_id=?').all(row.id).map(m => ({ modelId:m.model_id, displayName:m.display_name, contextLimit:m.context_limit ?? undefined, outputLimit:m.output_limit ?? undefined, reasoningVariants:JSON.parse(m.reasoning_variants_json), params:JSON.parse(m.params_json), isDefault:!!m.is_default, enabled:!!m.enabled }))
      target.saveProvider({id:row.id,displayName:row.display_name,protocol:row.protocol,baseUrl:row.base_url,defaultModel:row.default_model,enabled:true,isRelay:!!row.is_relay,capabilities:JSON.parse(row.capabilities_json),models}, Buffer.from(row.encrypted_key))
    }
    const search = source.prepare("SELECT encrypted_key FROM search_service_secrets WHERE service_id='doubao-custom'").get()
    if (search) target.saveSearchService({enabled:true},Buffer.from(search.encrypted_key))
  } finally { source.close(); target.close() }
  // Chromium's encrypted profile key is required to read copied safeStorage blobs.
  await copyFile(resolve(dirname(sourcePath), 'Local State'),resolve(root,'Local State'))
  app = await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:['.'],env:{...process.env,MOLIU_USER_DATA_DIR:root}})
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(()=>!!window.moliu)
  if (process.env.MOLIU_LIVE_SEARCH_KEY) await page.evaluate(apiKey=>window.moliu.searchService.save({enabled:true,apiKey}),process.env.MOLIU_LIVE_SEARCH_KEY)
  const provider = await page.evaluate(async()=> (await window.moliu.providers.list()).find(p=>p.enabled&&p.capabilities.chat&&p.hasApiKey))
  const connection = await check('现有文本服务连接', async()=> {
    assert.ok(provider,'没有已配置的文本服务')
    const result = await page.evaluate(id=>window.moliu.providers.test(id),provider.id)
    assert.ok(result.ok, result.message || '连接验证失败')
    return {provider:provider.displayName,model:provider.defaultModel}
  })
  const news = await check('豆包真实新闻检索及素材接入', async()=> {
    const result = await page.evaluate(()=>window.moliu.materials.search({query:'AI 人工智能 最新新闻',type:'web',count:5,timeRange:'OneWeek'}))
    assert.ok(result.results.length>0,'搜索返回空结果')
    const first = result.results.find(r=>r.sourceUrl&&r.title)
    assert.ok(first,'搜索结果缺标题或来源')
    const saved = await page.evaluate(result=>window.moliu.materials.addSearchResult({result,query:'AI 人工智能 最新新闻'}),first)
    assert.ok(saved.material.id)
    return {count:result.results.length,title:first.title,url:first.sourceUrl,materialId:saved.material.id}
  })
  if (connection) {
    await check('真实文本模型生成 AI 资讯账号',async()=> {
      const answers = ['AI 资讯','人工智能新闻与产品解读','希望快速掌握 AI 动态的职场读者','准确简洁，先事实再解读','可靠的资讯编辑','核验来源，不夸大能力','帮助读者理解新闻对工作和生活的影响'].map((answer,index)=>({questionId:String(index+1),question:`账号定位问题 ${index+1}`,answer}))
      const generated=await page.evaluate(({provider,answers})=>window.moliu.accounts.generate({providerId:provider.id,model:provider.defaultModel,answers}),{provider,answers})
      assert.ok(generated.fields.length>=7)
      const saved=await page.evaluate(({fields,answers})=>window.moliu.accounts.save({fields,wizardAnswers:answers,status:'locked',source:'ai'}),{fields:generated.fields,answers})
      return {accountId:saved.id,fieldCount:generated.fields.length,newsAvailable:!!news}
    })
  } else {
    report.skipped.push('真实账号及后续文本生成：现有文本服务连接失败，详见连接检查结果')
  }
} finally {
  await app?.close()
  await writeFile(resolve('artifacts/live-configured-services.json'),JSON.stringify(report,null,2))
  if (root.startsWith(resolve(tmpdir())+sep) && root.includes('moliu-live-configured-')) await rm(root,{recursive:true,force:true})
}
if (report.checks.some(check=>!check.passed)) process.exitCode=1
