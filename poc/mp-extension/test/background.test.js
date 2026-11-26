import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MP_URL = "https://mp.weixin.qq.com/cgi-bin/appmsg?mock=1";
const CONFIRM = "WRITE_CURRENT_MP_EDITOR";

function setup() {
  const state = {
    url: MP_URL,
    content: "<h1>原始文章</h1>",
    ready: true,
    apiCalls: [],
    executeCalls: 0,
    writes: 0,
    failLastOperationSave: false,
    changeOnSecondGet: false
  };
  const storageData = {};
  const listeners = [];
  let getCount = 0;
  let backupId = 0;

  const api = {
    get_isready() {
      state.apiCalls.push("get_isready");
      return state.ready;
    },
    get_content() {
      state.apiCalls.push("get_content");
      getCount += 1;
      if (state.changeOnSecondGet && getCount === 2) state.content = "<p>备份后漂移</p>";
      return state.content;
    },
    set_content(html) {
      state.apiCalls.push("set_content");
      state.writes += 1;
      state.content = html;
      return true;
    },
    insert_html(html) {
      state.apiCalls.push("insert_html");
      state.writes += 1;
      state.content += html;
      return true;
    }
  };

  const context = {
    console,
    URL,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => `backup-${++backupId}` },
    window: { __MP_Editor_JSAPI__: api },
    location: { href: state.url },
    chrome: {
      tabs: {
        get: async (tabId) => ({ id: tabId, url: state.url })
      },
      scripting: {
        executeScript: async (options) => {
          state.executeCalls += 1;
          return [{ result: await options.func(...options.args) }];
        }
      },
      storage: {
        local: {
          async get(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            const result = {};
            for (const key of list) {
              if (storageData[key] !== undefined) result[key] = structuredClone(storageData[key]);
            }
            return result;
          },
          async set(values) {
            for (const [key, value] of Object.entries(values)) {
              if (key === "mpPoc.lastOperation.v1" && state.failLastOperationSave) {
                throw new Error("模拟存储失败");
              }
              storageData[key] = structuredClone(value);
              state.apiCalls.push(`storage:${key}`);
            }
          }
        }
      },
      runtime: {
        id: "mp-poc-test",
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          }
        }
      }
    }
  };
  vm.createContext(context);
  context.importScripts = (file) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), context, {
    filename: "background.js"
  });

  async function send(message) {
    assert.equal(listeners.length, 1);
    return new Promise((resolve) => {
      const keepChannel = listeners[0](message, { id: "mp-poc-test" }, resolve);
      assert.equal(keepChannel, true);
    });
  }

  return { state, storageData, send };
}

test("启动只注册监听器；人工 detect 仅调用 get_isready", async () => {
  const { state, send } = setup();
  assert.equal(state.executeCalls, 0);
  assert.equal(state.writes, 0);
  const response = await send({ type: "MP_POC_DETECT", tabId: 1 });
  assert.equal(response.ok, true);
  assert.equal(response.result.detected, true);
  assert.deepEqual(state.apiCalls, ["get_isready"]);
  assert.equal(state.executeCalls, 1);
  assert.equal(state.writes, 0);
});

test("缺少人工确认时不读取页面、更不写入", async () => {
  const { state, send } = setup();
  const response = await send({
    type: "MP_POC_WRITE",
    tabId: 1,
    operation: "set_content",
    html: "<p>禁止</p>"
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "MANUAL_CONFIRMATION_REQUIRED");
  assert.equal(response.writeCalled, false);
  assert.equal(state.executeCalls, 0);
  assert.equal(state.content, "<h1>原始文章</h1>");
});

test("成功 set：先持久备份，再漂移检查、单次写入和读回", async () => {
  const { state, storageData, send } = setup();
  const response = await send({
    type: "MP_POC_WRITE",
    tabId: 1,
    operation: "set_content",
    html: "<p>新文章</p>",
    confirmation: CONFIRM
  });
  assert.equal(response.ok, true);
  assert.equal(response.writeCalled, true);
  assert.equal(response.result.afterContent, "<p>新文章</p>");
  assert.equal(state.writes, 1);
  assert.deepEqual(state.apiCalls.slice(0, 6), [
    "get_isready",
    "get_content",
    "storage:mpPoc.backups.v1",
    "get_isready",
    "get_content",
    "set_content"
  ]);
  const backups = storageData["mpPoc.backups.v1"]["1"];
  assert.equal(backups.length, 1);
  assert.equal(backups[0].content, "<h1>原始文章</h1>");
  assert.equal(response.backup.id, backups[0].id);
  assert.equal(storageData["mpPoc.lastOperation.v1"]["1"].afterContent, "<p>新文章</p>");
});

test("备份后内容漂移会返回备份但 writeCalled=false", async () => {
  const { state, send } = setup();
  state.changeOnSecondGet = true;
  const response = await send({
    type: "MP_POC_WRITE",
    tabId: 1,
    operation: "set_content",
    html: "<p>不应写入</p>",
    confirmation: CONFIRM
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "CONTENT_CHANGED_BEFORE_WRITE");
  assert.equal(response.writeCalled, false);
  assert.ok(response.backup);
  assert.equal(state.writes, 0);
  assert.equal(state.content, "<p>备份后漂移</p>");
});

test("较新的手工备份优先于更早的写入基线", async () => {
  const { state, send } = setup();
  await send({
    type: "MP_POC_WRITE",
    tabId: 1,
    operation: "set_content",
    html: "<p>第一次写入</p>",
    confirmation: CONFIRM
  });
  state.content = "<p>后续人工编辑</p>";
  await new Promise((resolve) => setTimeout(resolve, 5));
  await send({ type: "MP_POC_BACKUP", tabId: 1 });
  const response = await send({ type: "MP_POC_READBACK", tabId: 1 });
  assert.equal(response.ok, true);
  assert.equal(response.baseline.kind, "latest-backup");
  assert.equal(response.baseline.content, "<p>后续人工编辑</p>");
});

test("写入读回后状态保存失败仍明确 writeCalled=true", async () => {
  const { state, send } = setup();
  state.failLastOperationSave = true;
  const response = await send({
    type: "MP_POC_WRITE",
    tabId: 1,
    operation: "insert_html",
    html: "<p>追加</p>",
    confirmation: CONFIRM
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "LAST_OPERATION_SAVE_FAILED_AFTER_WRITE");
  assert.equal(response.writeCalled, true);
  assert.equal(state.writes, 1);
  assert.equal(state.content, "<h1>原始文章</h1><p>追加</p>");
});

test("非公众号且非 localhost 页面不执行脚本", async () => {
  const { state, send } = setup();
  state.url = "https://example.com/";
  const response = await send({ type: "MP_POC_DETECT", tabId: 1 });
  assert.equal(response.ok, false);
  assert.equal(state.executeCalls, 0);
  assert.equal(state.writes, 0);
});
