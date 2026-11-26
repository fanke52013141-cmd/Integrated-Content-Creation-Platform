let currentTab = null;
let busy = false;

const byId = (id) => document.getElementById(id);

function status(message, kind = "") {
  byId("status").textContent = message;
  byId("status").className = kind;
}

function print(id, value) {
  byId(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll("button").forEach((button) => { button.disabled = value; });
}

async function request(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, tabId: currentTab.id, ...extra });
}

function responseError(response) {
  return new Error(response && response.error ? response.error.message : "扩展未返回有效结果");
}

function showBackup(backup) {
  if (!backup) return;
  print("backup-output", {
    backupId: backup.id,
    createdAt: backup.createdAt,
    url: backup.url,
    contentLength: backup.content.length,
    persisted: "chrome.storage.local"
  });
}

function renderDiff(beforeContent, afterContent) {
  const diff = MpDiff.summarize(beforeContent, afterContent);
  print("diff-output", {
    总体变化: diff.changed ? "有" : "无",
    文本: {
      变化: diff.text.changed ? "有" : "无",
      长度: `${diff.text.beforeLength} → ${diff.text.afterLength}`,
      增减: diff.text.delta,
      首个差异: diff.text.firstDifference
    },
    DOM: {
      变化: diff.dom.changed ? "有" : "无",
      元素数: `${diff.dom.beforeElements} → ${diff.dom.afterElements}`,
      增减: diff.dom.elementDelta,
      新增标签: diff.dom.addedTags,
      移除标签: diff.dom.removedTags
    }
  });
}

async function detect() {
  const response = await request("MP_POC_DETECT");
  if (!response.ok) throw responseError(response);
  const result = response.result;
  if (!result.ok) throw responseError(result);
  print("read-output", result);
  const detail = `transport=${result.transport}；ready=${result.ready}；isNew=${result.isNew}；内容API=${result.contentSupported ? "可用" : "不可用"}`;
  status(result.detected ? `已检测到 JSAPI；${detail}` : "当前页面未检测到 JSAPI", result.detected && result.contentSupported ? "success" : "error");
}

async function backup() {
  const response = await request("MP_POC_BACKUP");
  if (!response.ok) throw responseError(response);
  showBackup(response.backup);
  print("read-output", {
    ready: response.read.ready,
    contentLength: response.read.content.length,
    methods: response.read.methods
  });
  status("已读取并持久化备份；尚未写入", "success");
}

async function readback() {
  const response = await request("MP_POC_READBACK");
  if (!response.ok) throw responseError(response);
  print("read-output", {
    ready: response.read.ready,
    contentLength: response.read.content.length,
    contentPreview: response.read.content.slice(0, 300)
  });
  if (response.baseline) {
    renderDiff(response.baseline.content, response.read.content);
    status(`已读回，并与 ${response.baseline.kind} 比较`, "success");
  } else {
    print("diff-output", "没有同 URL 的历史备份，当前仅执行读回。可点击“读取并备份”建立基线。");
    status("已读回；尚无比较基线", "success");
  }
}

async function write() {
  if (byId("confirmation").value !== "写入") {
    throw new Error("请在确认框完整输入：写入");
  }
  const operation = byId("operation").value;
  const html = byId("html").value;
  const response = await request("MP_POC_WRITE", {
    operation,
    html,
    confirmation: "WRITE_CURRENT_MP_EDITOR"
  });
  showBackup(response.backup);
  if (!response.ok) {
    if (response.writeCalled) {
      print("diff-output", "警告：写入 API 已调用，但读回或后续步骤失败。请人工检查页面，不要直接重复写入。");
    }
    throw responseError(response);
  }
  renderDiff(response.backup.content, response.result.afterContent);
  print("read-output", {
    operation: response.result.operation,
    writeCalled: response.result.writeCalled,
    writeResult: response.result.writeResult,
    readbackLength: response.result.afterContent.length
  });
  status("写入 API 已调用一次，且已 get_content 读回；请人工检查页面", "success");
}

async function run(action) {
  if (busy || !currentTab) return;
  setBusy(true);
  status("正在执行人工请求……");
  try {
    await action();
  } catch (error) {
    status(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0] || null;
  print("tab-url", currentTab && currentTab.url ? currentTab.url : "没有可用标签页");
  byId("detect").addEventListener("click", () => run(detect));
  byId("backup").addEventListener("click", () => run(backup));
  byId("readback").addEventListener("click", () => run(readback));
  byId("write").addEventListener("click", () => run(write));
});
