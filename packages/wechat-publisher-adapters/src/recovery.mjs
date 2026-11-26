import { validationError } from './errors.mjs';

/**
 * Reconcile a remote draft first, then reopen the persisted machine record.
 * This also handles the current DeliveryMachine early-return for
 * needs_reconciliation even when resume({ reconcile:true }) is supplied.
 */
export async function reconcileDraftAndResume({
  machine,
  drafts,
  key,
  account,
  idempotencyKey,
  mediaId,
}) {
  if (!machine?.store || !machine?.resume || !drafts?.reconcile) {
    throw new TypeError('machine.store/resume and drafts.reconcile are required');
  }
  await drafts.reconcile({ account, idempotencyKey, mediaId });
  await machine.store.runExclusive(key, async () => {
    const record = await machine.store.load(key);
    if (!record) throw validationError(`Unknown delivery: ${key}`, 'DELIVERY_NOT_FOUND');
    if (record.status !== 'needs_reconciliation') {
      throw validationError(`Delivery is not waiting for reconciliation: ${record.status}`, 'INVALID_RECOVERY_STATE');
    }
    record.status = 'pending';
    record.error = null;
    record.currentStep = 'draftAdd';
    await machine.store.save(record);
  });
  return machine.resume(key);
}
