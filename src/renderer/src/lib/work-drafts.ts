import { createWorkDraftStore } from '../../../shared/work-draft-store'
export type { DraftState } from '../../../shared/work-draft-store'
export const { subscribeDraft, getDraftState, updateWorkDraft, flushWorkDraft, reloadWorkDraft, discardWorkDraft } = createWorkDraftStore({
  getDraft: id => window.moliu.articles.getDraft(id),
  saveDraft: input => window.moliu.articles.saveDraft(input),
  discardDraft: id => window.moliu.articles.discardDraft(id)
})
