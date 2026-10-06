import { useEffect, useState } from 'react'
import { DatabaseBackup, Download, RotateCcw } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useConfirm } from '../components/useConfirm'
import type { ToastState } from '../components/Toast'
import { errorMessage } from '../lib'

export function DataPage({ showToast }: { showToast(toast: ToastState): void }): React.JSX.Element {
  const [path, setPath] = useState('')
  const [bundles, setBundles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const { confirm, ConfirmPortal } = useConfirm()
  const load = async (): Promise<void> => {
    const [directory, backups] = await Promise.all([window.moliu.app.getDataPath(), window.moliu.app.listBackups()])
    setPath(directory); setBundles(backups)
  }
  useEffect(() => { void load().catch(error => showToast({ type: 'error', message: errorMessage(error) })) }, [])
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
    if (!(await confirm({ title: '恢复这份备份？', message: '当前文章、图片和配置会被备份内容替换。系统会校验完整性并保留恢复前副本；失败时自动回退。请先保存正在编辑的正文。', danger: true, confirmLabel: '恢复备份' }))) return
    setBusy(true)
    try { await window.moliu.app.restoreBackup({ bundleDir }); reloadAfterRestore() }
    catch (error) { showToast({ type: 'error', message: errorMessage(error) }); setBusy(false) }
  }
  return <div className="page">
    <PageHeader title="数据与备份" description="保存文章、工作草稿、发布信息和图片的完整副本。" />
    <section className="panel data-panel">
      <div className="section-heading"><h3><DatabaseBackup size={18} />本地数据</h3><button className="button primary" disabled={busy} onClick={() => void backup()}><Download size={15} />{busy ? '正在处理…' : '立即备份'}</button></div>
      <div className="section-heading"><button className="button secondary" disabled={busy} onClick={() => void portable(false)}>导出到外部目录（不含密钥）</button><button className="button secondary" disabled={busy} onClick={() => void portable(true)}>选择外部备份并核对</button></div>
      <p className="micro-copy">数据目录：<code>{path || '正在读取…'}</code></p>
      <p className="micro-copy">生成、上传或暂存进行中时，请等待完成再备份或恢复。备份包含 AI 服务与公众号配置，请妥善保存。</p>
      {bundles.length ? bundles.map(bundle => <article key={bundle} className="version-item"><strong>{bundle.split(/[\\/]/).pop()}</strong><button className="button secondary compact" disabled={busy} onClick={() => void restore(bundle)}><RotateCcw size={14} />恢复</button></article>) : <p>还没有备份，点击“立即备份”创建第一份。</p>}
    </section>
    {ConfirmPortal}
  </div>
}
