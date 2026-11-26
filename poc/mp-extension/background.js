importScripts("page-api.js");

const BACKUPS_KEY = "mpPoc.backups.v1";
const LAST_OPERATION_KEY = "mpPoc.lastOperation.v1";
const MAX_BACKUPS_PER_TAB = 5;
const WRITE_CONFIRMATION = "WRITE_CURRENT_MP_EDITOR";

function supportedTabUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" && url.hostname === "mp.weixin.qq.com") return true;
    return ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch (_) {
    return false;
  }
}

async function checkedTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("无效的标签页 ID");
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !supportedTabUrl(tab.url)) {
    throw new Error("仅允许当前公众号标签页或 localhost/127.0.0.1 本地 mock 页面");
  }
  return tab;
}

async function executePageOperation(tabId, operation) {
  await checkedTab(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: runMpOperation,
    args: [operation]
  });
  if (!results || !results[0] || !results[0].result) {
    throw new Error("页面操作未返回结果");
  }
  return results[0].result;
}

async function readEditor(tabId) {
  const result = await executePageOperation(tabId, { type: "read" });
  if (!result.ok) {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    throw error;
  }
  return result;
}

async function saveBackup(tabId, readResult) {
  const backup = {
    id: crypto.randomUUID(),
    tabId,
    url: readResult.url,
    createdAt: new Date().toISOString(),
    content: readResult.content
  };
  const stored = await chrome.storage.local.get(BACKUPS_KEY);
  const all = stored[BACKUPS_KEY] || {};
  const existing = all[String(tabId)] || [];
  all[String(tabId)] = [backup, ...existing].slice(0, MAX_BACKUPS_PER_TAB);
  // A failed persistence step aborts the write flow.
  await chrome.storage.local.set({ [BACKUPS_KEY]: all });
  return backup;
}

async function tabState(tabId) {
  const stored = await chrome.storage.local.get([BACKUPS_KEY, LAST_OPERATION_KEY]);
  const backups = (stored[BACKUPS_KEY] || {})[String(tabId)] || [];
  const lastOperation = (stored[LAST_OPERATION_KEY] || {})[String(tabId)] || null;
  return { latestBackup: backups[0] || null, lastOperation };
}

async function saveLastOperation(tabId, backup, operationResult) {
  const stored = await chrome.storage.local.get(LAST_OPERATION_KEY);
  const all = stored[LAST_OPERATION_KEY] || {};
  all[String(tabId)] = {
    backupId: backup.id,
    operation: operationResult.operation,
    url: backup.url,
    writtenAt: new Date().toISOString(),
    beforeContent: backup.content,
    afterContent: operationResult.afterContent
  };
  await chrome.storage.local.set({ [LAST_OPERATION_KEY]: all });
}

async function handleMessage(message) {
  const tabId = message && message.tabId;
  await checkedTab(tabId);

  if (message.type === "MP_POC_DETECT") {
    return { ok: true, result: await executePageOperation(tabId, { type: "detect" }) };
  }

  if (message.type === "MP_POC_BACKUP") {
    const read = await readEditor(tabId);
    const backup = await saveBackup(tabId, read);
    return { ok: true, backup, read };
  }

  if (message.type === "MP_POC_STATE") {
    return { ok: true, state: await tabState(tabId) };
  }

  if (message.type === "MP_POC_READBACK") {
    const read = await readEditor(tabId);
    const state = await tabState(tabId);
    let baseline = null;
    const hasLastOperation = state.lastOperation && state.lastOperation.url === read.url;
    const hasLatestBackup = state.latestBackup && state.latestBackup.url === read.url;
    const lastOperationIsNewer = hasLastOperation && (!hasLatestBackup ||
      Date.parse(state.lastOperation.writtenAt) >= Date.parse(state.latestBackup.createdAt));
    if (lastOperationIsNewer) {
      baseline = {
        kind: "last-write-backup",
        id: state.lastOperation.backupId,
        content: state.lastOperation.beforeContent
      };
    } else if (hasLatestBackup) {
      baseline = {
        kind: "latest-backup",
        id: state.latestBackup.id,
        content: state.latestBackup.content
      };
    }
    return { ok: true, read, baseline };
  }

  if (message.type === "MP_POC_WRITE") {
    if (message.confirmation !== WRITE_CONFIRMATION) {
      return {
        ok: false,
        writeCalled: false,
        error: { code: "MANUAL_CONFIRMATION_REQUIRED", message: "请输入指定确认文字后再写入" }
      };
    }
    if (!["set_content", "insert_html"].includes(message.operation)) {
      return {
        ok: false,
        writeCalled: false,
        error: { code: "UNKNOWN_OPERATION", message: "仅允许 set_content 或 insert_html" }
      };
    }
    if (typeof message.html !== "string") {
      return {
        ok: false,
        writeCalled: false,
        error: { code: "INVALID_HTML", message: "写入内容必须是字符串" }
      };
    }

    // Every write gets a fresh, persistent backup, even if the user made one earlier.
    const read = await readEditor(tabId);
    const backup = await saveBackup(tabId, read);
    const result = await executePageOperation(tabId, {
      type: message.operation,
      html: message.html,
      expectedBefore: backup.content,
      confirmation: message.confirmation
    });
    if (!result.ok) {
      return { ok: false, backup, writeCalled: result.writeCalled, error: result.error };
    }
    try {
      await saveLastOperation(tabId, backup, result);
    } catch (error) {
      return {
        ok: false,
        backup,
        result,
        writeCalled: true,
        error: {
          code: "LAST_OPERATION_SAVE_FAILED_AFTER_WRITE",
          message: "写入和读回已完成，但最近操作状态保存失败；请人工核验：" + error.message
        }
      };
    }
    return { ok: true, backup, result, writeCalled: true };
  }

  return {
    ok: false,
    error: { code: "UNKNOWN_MESSAGE", message: "未知扩展消息" }
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({
      ok: false,
      writeCalled: false,
      error: {
        code: error.code || "EXTENSION_OPERATION_FAILED",
        message: error && error.message ? error.message : String(error)
      }
    });
  });
  return true;
});
