import { useEffect, useMemo, useState } from 'react'
import { Braces, History, RotateCcw, Save } from 'lucide-react'
import type { PromptDefSummary, PromptVersionInfo } from '../../../shared/contracts'
import type { ToastState } from '../components/Toast'
import { errorMessage } from '../lib'

export function PromptsPage({ showToast }: { showToast(toast: ToastState): void }): React.JSX.Element {
  const [defs, setDefs] = useState<PromptDefSummary[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [versions, setVersions] = useState<PromptVersionInfo[]>([])
  const [busy, setBusy] = useState(false)

  const selected = useMemo(() => defs.find((d) => d.key === selectedKey), [defs, selectedKey])
  const variables = useMemo(() => {
    const found = new Set<string>()
    draft.replace(/{{\s*([^}\s]+)\s*}}/g, (_m, name: string) => { found.add(name); return '' })
    return [...found]
  }, [draft])
  const dirty = selected ? draft !== selected.activeContent : false

  const loadDef = async (): Promise<void> => {
    const list = await window.moliu.prompts.list()
    setDefs(list)
    setSelectedKey((x) => (list.some((d) => d.key === x) ? x : list[0]?.key ?? ''))
  }

  const loadSelected = async (key: string): Promise<void> => {
    const d = defs.find((x) => x.key === key)
    setDraft(d?.activeContent ?? '')
    setNote('')
    try {
      setVersions(await window.moliu.prompts.listVersions(key))
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
      setVersions([])
    }
  }

  useEffect(() => {
    void loadDef().catch((e) => showToast({ type: 'error', message: errorMessage(e) }))
  }, [])

  useEffect(() => {
    if (!selectedKey) return
    void loadSelected(selectedKey)
  }, [selectedKey])

  const reload = async (ok: string): Promise<void> => {
    await loadDef()
    if (selectedKey) await loadSelected(selectedKey)
    showToast({ type: 'success', message: ok })
  }

  const save = async (): Promise<void> => {
    if (!selectedKey || !dirty) return
    setBusy(true)
    try {
      await window.moliu.prompts.update({ key: selectedKey, content: draft, note: note.trim() || undefined })
      await reload('提示词已保存为新版本')
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const restore = async (version: number): Promise<void> => {
    if (!selectedKey || !selected) return
    if (!window.confirm(`确认将「${selected.title}」回滚到 v${version}？`)) return
    setBusy(true)
    try {
      await window.moliu.prompts.restore({ key: selectedKey, version })
      await reload(`已回滚到 v${version}`)
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    if (!selectedKey || !selected) return
    if (!window.confirm(`确认将「${selected.title}」重置回内置默认提示词？`)) return
    setBusy(true)
    try {
      await window.moliu.prompts.reset(selectedKey)
      await reload('已恢复为内置默认提示词')
    } catch (error) {
      showToast({ type: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page prompts-page">
      <section className="page-intro">
        <div>
          <h2>提示词</h2>
          <p>集中管理各 AI 环节的自定义提示词，支持版本回溯。写入 <code>{'{'} {'{'}</code>变量<code>{'}'}{'}'}</code> 可注入动态上下文。</p>
        </div>
      </section>

      <div className="provider-layout">
        <div className="provider-list-column">
          <div className="prompt-list" role="tablist" aria-label="提示词列表">
            {defs.map((d) => (
              <button
                key={d.key}
                role="tab"
                aria-selected={selectedKey === d.key}
                className={`provider-card prompt-card ${selectedKey === d.key ? 'selected' : ''}`}
                onClick={() => setSelectedKey(d.key)}
              >
                <span className="provider-logo"><Braces size={17} /></span>
                <span className="prompt-card-copy">
                  <strong>{d.title}</strong>
                  <small>{d.description}</small>
                  <code>{d.key}</code>
                </span>
                <span className="status-pill">v{d.activeVersion}</span>
              </button>
            ))}
          </div>
        </div>

        <section className="panel provider-editor prompt-editor" aria-live="polite">
          {selected ? (
            <>
              <div className="editor-heading">
                <span />
                <div className="editor-title">
                  <div>
                    <h2>{selected.title}</h2>
                    <p className="prompt-meta">{selected.key} · 共 {selected.versionCount} 个版本 · 当前激活 v{selected.activeVersion}</p>
                  </div>
                </div>
                <div className="editor-heading-actions">
                  {dirty && <span className="unsaved-dot">未保存</span>}
                  <button className="button secondary" onClick={() => void reset()} disabled={busy || selected.activeVersion === 1 && selected.versionCount === 1}><RotateCcw size={15} />重置默认</button>
                  <button className="button primary" onClick={() => void save()} disabled={busy || !dirty}><Save size={15} />保存为新版本</button>
                </div>
              </div>

              <label className="field prompt-textarea">
                <span>指令内容（整段编辑，自动追加到各环节的系统提示词）</span>
                <textarea
                  name="promptContent"
                  autoComplete="off"
                  rows={16}
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>

              <div className="prompt-vars">
                <h4>可用变量</h4>
                {variables.length
                  ? variables.map((v) => <code key={v} className="preset-chip var-chip">{'{'}{'{'} {v} {'}'}{'}'}</code>)
                  : <span className="prompt-vars-empty">当前内容未使用变量</span>}
              </div>

              <label className="field prompt-note">
                <span>版本说明（可选）</span>
                <input name="promptNote" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="记录本次修改的原因或要点" />
              </label>

              <div className="panel version-panel">
                <div className="version-panel-head">
                  <History size={15} />
                  <h4>版本历史</h4>
                </div>
                <div className="version-list">
                  {versions.map((v) => (
                    <div key={v.id} className={`version-item ${v.version === selected.activeVersion ? 'current' : ''}`}>
                      <span className="version-icon">{v.source === 'builtin' ? '内' : '改'}</span>
                      <span>
                        <strong>v{v.version} {v.note && <em>{v.note}</em>}</strong>
                        <small>{new Date(v.createdAt).toLocaleString()} {v.source === 'builtin' ? '· 内置' : '· 用户'}</small>
                      </span>
                      {v.version !== selected.activeVersion && (
                        <button className="button secondary compact" onClick={() => void restore(v.version)} disabled={busy}>回滚</button>
                      )}
                      {v.version === selected.activeVersion && <span className="status-pill success">当前</span>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="provider-empty">
              <Braces size={28} />
              <strong>暂无提示词</strong>
              <p>选择一个左侧提示词进行编辑</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}