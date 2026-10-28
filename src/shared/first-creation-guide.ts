const GUIDE_KEY = 'moliu:first-creation-guide:v1'

export function hasCompletedFirstCreationGuide(storage: { getItem(key: string): string | null }): boolean {
  try { return storage.getItem(GUIDE_KEY) === 'done' } catch { return false }
}

export function completeFirstCreationGuide(storage: { setItem(key: string, value: string): void }): void {
  try { storage.setItem(GUIDE_KEY, 'done') } catch { /* Storage may be unavailable. */ }
}
