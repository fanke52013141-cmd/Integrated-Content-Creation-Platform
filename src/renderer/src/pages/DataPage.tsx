import { useEffect, useState } from 'react'
import { DatabaseBackup, Download, FolderArchive, HardDrive, RotateCcw } from 'lucide-react'
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
  return <div className="page data-page">
    <PageHeader title="数据与备份" description="保存文章、工作草稿、发布信息和图片的完整副本。" actions={<button className="button primary" disabled={busy} onClick={() => void backup()}><Download size={15} />{busy ? '正在处理…' : '立即备份'}</button>} />
    <div className="data-workspace">
      <section className="panel data-history">
        <header className="data-section-heading"><div><h3>本地备份</h3><p>随时保留一份当前创作内容的副本。</p></div><span className="badge neutral">{bundles.length} 份</span></header>
        {bundles.length ? <div className="data-backup-list">{bundles.map(bundle => <article key={bundle} className="data-backup-row"><span className="data-file-icon"><DatabaseBackup size={20} /></span><div><strong>{bundle.split(/[\\/]/).pop()}</strong><small>本地完整备份</small></div><button className="button secondary compact" disabled={busy} onClick={() => void restore(bundle)}><RotateCcw size={14} />恢复</button></article>)}</div> : <div className="data-empty"><DatabaseBackup size={32} /><h3>还没有备份</h3><p>创建第一份备份，保留当前文章、图片和配置。</p><button className="button secondary" disabled={busy} onClick={() => void backup()}>创建第一份备份</button></div>}
      </section>
      <aside className="data-sidebar">
        <section className="panel data-storage"><h3><HardDrive size={18} />本地存储</h3><p>数据保存在这台设备的目录中。</p><code>{path || '正在读取…'}</code></section>
        <section className="panel data-transfer"><h3><FolderArchive size={18} />备份迁移</h3><p>将备份带到其他设备，或核对外部备份后恢复。</p><button className="button secondary" disabled={busy} onClick={() => void portable(false)}><Download size={15} />导出到外部目录</button><small>导出文件不包含密钥。</small><div className="data-transfer-divider" /><button className="button secondary" disabled={busy} onClick={() => void portable(true)}><FolderArchive size={15} />选择外部备份并核对</button></section>
        <p className="data-note">生成、上传或暂存进行中时，请等待完成再备份或恢复。本地完整备份包含 AI 服务与公众号配置，请妥善保存。</p>
      </aside>
    </div>
    {ConfirmPortal}
  </div>
}
