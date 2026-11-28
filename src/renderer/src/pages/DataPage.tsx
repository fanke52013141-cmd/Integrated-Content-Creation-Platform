import { useEffect, useState } from 'react'
import { BarChart3, DatabaseBackup, Download, FolderArchive, HardDrive, RotateCcw } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useConfirm } from '../components/useConfirm'
import type { ToastState } from '../components/Toast'
import { GENERATION_DOMAIN_LABELS, type UsageLedgerSummary } from '../../../shared/contracts'
import { errorMessage } from '../lib'

const PRICING_STORAGE_KEY = 'moliu:ledger-text-pricing:v1'

interface TextPricing {
  inputPerMillion: number
  outputPerMillion: number
}

function loadTextPricing(): TextPricing {
  try {
    const raw = localStorage.getItem(PRICING_STORAGE_KEY)
    if (!raw) return { inputPerMillion: 0, outputPerMillion: 0 }
    const parsed = JSON.parse(raw) as Partial<TextPricing>
    return {
      inputPerMillion: Number.isFinite(parsed.inputPerMillion) && (parsed.inputPerMillion ?? 0) >= 0 ? Number(parsed.inputPerMillion) : 0,
      outputPerMillion: Number.isFinite(parsed.outputPerMillion) && (parsed.outputPerMillion ?? 0) >= 0 ? Number(parsed.outputPerMillion) : 0
    }
  } catch {
    return { inputPerMillion: 0, outputPerMillion: 0 }
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function DataPage({ showToast }: { showToast(toast: ToastState): void }): React.JSX.Element {
  const [path, setPath] = useState('')
  const [bundles, setBundles] = useState<string[]>([])
  const [ledgerDays, setLedgerDays] = useState<7 | 30>(7)
  const [ledger, setLedger] = useState<UsageLedgerSummary | null>(null)
  const [pricing, setPricing] = useState<TextPricing>(() => loadTextPricing())
  const [busy, setBusy] = useState(false)
  const [inspection, setInspection] = useState<{ bundle: string; message: string } | null>(null)
  const { confirm, ConfirmPortal } = useConfirm()
  const load = async (days: 7 | 30 = ledgerDays): Promise<void> => {
    const [directory, backups, usage] = await Promise.all([
      window.moliu.app.getDataPath(),
      window.moliu.app.listBackups(),
      window.moliu.app.getUsageLedger(days)
    ])
    setPath(directory); setBundles(backups); setLedger(usage)
  }
  useEffect(() => { void load(ledgerDays).catch(error => showToast({ type: 'error', message: errorMessage(error) })) }, [ledgerDays])
  const updatePricing = (patch: Partial<TextPricing>): void => {
    setPricing((current) => {
      const next = { ...current, ...patch }
      try { localStorage.setItem(PRICING_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  const estimateTextCost = (promptTokens: number, completionTokens: number): number =>
    (promptTokens / 1_000_000) * pricing.inputPerMillion + (completionTokens / 1_000_000) * pricing.outputPerMillion
  const backup = async (): Promise<void> => {
    setBusy(true)
    try { const result = await window.moliu.app.createBackup(); await load(); showToast({ type: 'success', message: `备份已创建：${result.path}` }) }
    catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }
  const portable = async (importing: boolean): Promise<void> => {
    setBusy(true)
    try {
      if (importing) {
        const selected = await window.moliu.app.selectPortableBackup()
        if (!selected) return
        if (await confirm({ title: '核对外部备份并恢复？', message: selected.summary + ' 当前数据将被替换，恢复前自动保留副本。', danger: true, confirmLabel: '恢复备份' })) {
          await window.moliu.app.restoreBackup({ bundleDir: selected.bundleDir }); reloadAfterRestore()
        }
      } else { const result = await window.moliu.app.exportPortableBackup(); if (result.path) showToast({ type: 'success', message: `可携带备份已导出：${result.path}（不含密钥）` }) }
      await load()
    } catch (error) { showToast({ type: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }
  const reloadAfterRestore = (): void => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('moliu:draft:') || key.startsWith('moliu:topic-') || /moliu:.*(?:selection|active-work|default-model)/.test(key)) localStorage.removeItem(key)
    window.location.reload()
  }
  const restore = async (bundleDir: string): Promise<void> => {
    if (!(await confirm({ title: '恢复这份备份？', message: '当前数据会被备份内容替换（失败自动回退，恢复前保留副本）。请先保存正在编辑的正文。', danger: true, confirmLabel: '恢复备份' }))) return
    setBusy(true)
    try { await window.moliu.app.restoreBackup({ bundleDir }); reloadAfterRestore() }
    catch (error) { showToast({ type: 'error', message: errorMessage(error) }); setBusy(false) }
  }
  const inspect = async (bundleDir: string): Promise<void> => {
    setBusy(true); setInspection(null)
    try {
      const result = await window.moliu.app.inspectBackup({ bundleDir })
      setInspection({ bundle: bundleDir, message: `数据库与清单中的 ${result.images} 张图片校验通过；记录 ${result.articles ?? '未知'} 篇文章，${result.credentialsIncluded ? '包含本机加密凭证' : '不含密钥'}。未执行恢复演练。` })
    } catch (error) { setInspection({ bundle: bundleDir, message: `检查未通过：${errorMessage(error)}。未修改当前数据。` }) }
    finally { setBusy(false) }
  }
  return <div className="page data-page">
    <PageHeader title="数据与备份" description="保存文章、工作草稿、发布信息和图片的完整副本。" actions={<button className="button primary" disabled={busy} onClick={() => void backup()}><Download size={16} />{busy ? '正在处理…' : '立即备份'}</button>} />
    <div className="data-workspace">
      <section className="panel data-ledger">
        <header className="data-section-heading">
          <div>
            <h3><BarChart3 size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />模型用量与成本账本</h3>
            <p>基于本机调用日志汇总 Token、均耗时与费用；可填入常用文本参考单价估算开销。</p>
          </div>
          <div className="data-ledger-range" role="group" aria-label="统计周期">
            <button type="button" className={ledgerDays === 7 ? 'button secondary compact' : 'button ghost compact'} onClick={() => setLedgerDays(7)}>近 7 天</button>
            <button type="button" className={ledgerDays === 30 ? 'button secondary compact' : 'button ghost compact'} onClick={() => setLedgerDays(30)}>近 30 天</button>
          </div>
        </header>
        {ledger ? (
          <>
            <div className="data-ledger-kpis">
              <div className="data-kpi">
                <span>模型调用</span>
                <strong>{ledger.totals.calls}</strong>
                <small>成功 {ledger.totals.successCalls} · 失败 {ledger.totals.failedCalls}</small>
              </div>
              <div className="data-kpi">
                <span>总 Token</span>
                <strong>{formatTokens(ledger.totals.totalTokens)}</strong>
                <small>入 {formatTokens(ledger.totals.promptTokens)} / 出 {formatTokens(ledger.totals.completionTokens)}</small>
              </div>
              <div className="data-kpi">
                <span>平均耗时</span>
                <strong>{ledger.totals.avgLatencyMs ? `${(ledger.totals.avgLatencyMs / 1000).toFixed(1)}s` : '—'}</strong>
                <small>近 {ledger.days} 天均值</small>
              </div>
              <div className="data-kpi">
                <span>费用估算</span>
                <strong>
                  {pricing.inputPerMillion > 0 || pricing.outputPerMillion > 0
                    ? `¥${estimateTextCost(ledger.totals.promptTokens, ledger.totals.completionTokens).toFixed(2)}`
                    : ledger.totals.recordedCostUsd > 0
                      ? `$${ledger.totals.recordedCostUsd.toFixed(3)}`
                      : '未设单价'}
                </strong>
                <small>{ledger.totals.recordedCostUsd > 0 ? `含实记生图 $${ledger.totals.recordedCostUsd.toFixed(3)}` : '可在下方填文本参考单价'}</small>
              </div>
            </div>
            <div className="data-ledger-pricing">
              <label>
                <span>输入参考单价（元/百万 Token）</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={pricing.inputPerMillion || ''}
                  placeholder="如 2"
                  onChange={(e) => updatePricing({ inputPerMillion: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label>
                <span>输出参考单价（元/百万 Token）</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={pricing.outputPerMillion || ''}
                  placeholder="如 8"
                  onChange={(e) => updatePricing({ outputPerMillion: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
            </div>
            {ledger.byModel.length > 0 ? (
              <div className="data-ledger-table-wrap">
                <table className="data-ledger-table">
                  <thead>
                    <tr>
                      <th>供应商 / 模型</th>
                      <th>调用（成功/失败）</th>
                      <th>Token（入/出）</th>
                      <th>均耗时</th>
                      <th>估算费用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.byModel.map((row) => {
                      const est = estimateTextCost(row.promptTokens, row.completionTokens)
                      return (
                        <tr key={`${row.providerId ?? 'none'}-${row.model}`}>
                          <td><strong>{row.model}</strong><small>{row.providerName}</small></td>
                          <td>{row.calls}（{row.successCalls}/{row.failedCalls}）</td>
                          <td>{formatTokens(row.totalTokens)}<small>{formatTokens(row.promptTokens)} / {formatTokens(row.completionTokens)}</small></td>
                          <td>{row.avgLatencyMs ? `${(row.avgLatencyMs / 1000).toFixed(1)}s` : '—'}</td>
                          <td>
                            {est > 0 ? `¥${est.toFixed(3)}` : ''}
                            {est > 0 && row.recordedCostUsd > 0 ? ' + ' : ''}
                            {row.recordedCostUsd > 0 ? `$${row.recordedCostUsd.toFixed(3)}` : est > 0 ? '' : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="data-ledger-empty">近 {ledger.days} 天暂无模型调用记录。</p>
            )}
            {ledger.byStage.length > 0 && (
              <div className="data-ledger-stages">
                <span className="data-ledger-stages-label">按环节任务数：</span>
                {ledger.byStage.map((stage) => (
                  <span key={stage.domain} className="badge neutral">
                    {GENERATION_DOMAIN_LABELS[stage.domain] ?? stage.domain} {stage.completedTasks}/{stage.totalTasks}
                    {stage.failedTasks > 0 ? `（异常 ${stage.failedTasks}）` : ''}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="data-ledger-empty">正在读取账本…</p>
        )}
      </section>
      <section className="panel data-history">
        <header className="data-section-heading"><div><h3>本地备份</h3><p>随时保留一份当前创作内容的副本。</p></div><span className="badge neutral">{bundles.length} 份</span></header>
        {bundles.length ? <div className="data-backup-list">{bundles.map(bundle => <article key={bundle} className="data-backup-row"><span className="data-file-icon"><DatabaseBackup size={20} /></span><div><strong>{bundle.split(/[\\/]/).pop()}</strong><small>本地备份{inspection?.bundle === bundle && <span role="status"> · {inspection.message}</span>}</small></div><button className="button ghost compact" disabled={busy} onClick={() => void inspect(bundle)}>检查</button><button className="button secondary compact" disabled={busy} onClick={() => void restore(bundle)}><RotateCcw size={16} />恢复</button></article>)}</div> : <div className="data-empty"><DatabaseBackup size={32} /><h3>还没有备份</h3><p>备份包含文章、图片和配置的完整副本。</p><button className="button secondary" disabled={busy} onClick={() => void backup()}>创建第一份备份</button></div>}
      </section>
      <aside className="data-sidebar">
        <section className="panel data-storage"><h3><HardDrive size={20} />本地存储</h3><code>{path || '正在读取…'}</code></section>
        <section className="panel data-transfer"><h3><FolderArchive size={20} />备份迁移</h3><p>将备份带到其他设备，或核对外部备份后恢复。</p><button className="button secondary" disabled={busy} onClick={() => void portable(false)}><Download size={16} />导出到外部目录</button><small>导出文件不包含密钥。</small><div className="data-transfer-divider" /><button className="button secondary" disabled={busy} onClick={() => void portable(true)}><FolderArchive size={16} />选择外部备份并核对</button></section>
        <p className="data-note">备份包含 AI 服务与公众号配置等全部数据，请妥善保存。</p>
      </aside>
    </div>
    {ConfirmPortal}
  </div>
}
