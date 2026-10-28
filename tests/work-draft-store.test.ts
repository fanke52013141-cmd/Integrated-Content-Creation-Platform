import { expect, it } from 'vitest'
import { createWorkDraftStore } from '../src/shared/work-draft-store.js'
import type { WorkDraft, SaveWorkDraftInput } from '../src/shared/contracts.js'


async function store() {
  let remote: WorkDraft | null = null
  const api = {
    getDraft: async () => remote,
    saveDraft: async (input: SaveWorkDraftInput) => {
      if (input.expectedRevision !== (remote?.revision ?? 0)) throw new Error('修订冲突')
      remote = { ...input, revision: (remote?.revision ?? 0) + 1, updatedAt: 'now' }
      return remote
    },
    discardDraft: async () => { remote = null }
  }
  const drafts = createWorkDraftStore(api)
  await drafts.flushWorkDraft('article')
  return { ...drafts, commit: () => { remote = null }, getRemote: () => remote }
}

it('保存期间新增输入不会被提交完成后的同步清空', async () => {
  const drafts = await store()
  drafts.updateWorkDraft('article', 'version-1', '已提交的正文')
  await drafts.flushWorkDraft('article')
  drafts.commit()
  // UI 在提交响应回来前继续输入；旧修订号此时会被主进程拒绝。
  drafts.updateWorkDraft('article', 'version-1', '已提交的正文 + 新增文字')
  await drafts.reloadWorkDraft('article', { currentVersionId: 'version-2', consumedContent: '已提交的正文' })
  expect(drafts.getDraftState('article').content).toBe('已提交的正文 + 新增文字')
  expect(drafts.getRemote()).toMatchObject({ content: '已提交的正文 + 新增文字', baseVersionId: 'version-2' })
})

it('未继续输入时清除已提交草稿；AI 改稿期间的输入保留旧基础版本用于对比', async () => {
  const drafts = await store()
  drafts.updateWorkDraft('article', 'version-1', '提交内容')
  await drafts.flushWorkDraft('article'); drafts.commit()
  await drafts.reloadWorkDraft('article', { currentVersionId: 'version-2', consumedContent: '提交内容' })
  expect(drafts.getDraftState('article').content).toBeUndefined()
  drafts.updateWorkDraft('article', 'version-2', 'AI 生成期间继续写')
  await drafts.flushWorkDraft('article'); drafts.commit()
  await drafts.reloadWorkDraft('article', { currentVersionId: 'AI-version', consumedContent: '提交给 AI 的内容', rebase: false })
  expect(drafts.getRemote()?.baseVersionId).toBe('version-2')
  expect(drafts.getDraftState('article').content).toBe('AI 生成期间继续写')
})

it('连续输入合并待写内容，并在 flush 前持久化最后一次编辑', async () => {
  let remote: WorkDraft | null = null
  let release!: () => void
  let started!: () => void
  const firstStarted = new Promise<void>(resolve => { started = resolve })
  const firstWrite = new Promise<void>(resolve => { release = resolve })
  let writes = 0
  const drafts = createWorkDraftStore({
    getDraft: async () => remote,
    saveDraft: async input => {
      writes += 1
      if (writes === 1) { started(); await firstWrite }
      expect(input.expectedRevision).toBe(remote?.revision ?? 0)
      remote = { ...input, revision: (remote?.revision ?? 0) + 1, updatedAt: 'now' }
      return remote
    },
    discardDraft: async () => { remote = null }
  })
  await drafts.flushWorkDraft('article')
  drafts.updateWorkDraft('article', 'version-1', 'first')
  await firstStarted
  for (let i = 0; i < 100; i += 1) drafts.updateWorkDraft('article', 'version-1', `正文 ${i}`)
  release()
  const saved = await drafts.flushWorkDraft('article')
  expect(writes).toBe(2)
  expect(saved?.content).toBe('正文 99')
  expect(drafts.getDraftState('article').status).toBe('saved')
})
