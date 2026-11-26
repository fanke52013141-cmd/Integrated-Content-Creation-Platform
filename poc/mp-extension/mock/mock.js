const editor = document.getElementById("editor");
const initialContent = editor.innerHTML;
const mockState = {
  ready: true,
  isNew: true,
  invokeReturnMode: "callback",
  errorApiName: null,
  neverCallbackApiName: null
};

const directApi = {
  get_isready() {
    return mockState.ready;
  },
  get_content() {
    return editor.innerHTML;
  },
  set_content(html) {
    editor.innerHTML = html;
    return { accepted: true, operation: "set_content" };
  },
  insert_html(html) {
    editor.insertAdjacentHTML("beforeend", html);
    return { accepted: true, operation: "insert_html" };
  }
};

const officialCalls = [];
const officialApi = {
  invoke({ apiName, apiParam = {}, sucCb, errCb }) {
    officialCalls.push({
      apiName,
      apiParam: JSON.parse(JSON.stringify(apiParam)),
      hasCallbacks: typeof sucCb === "function" && typeof errCb === "function"
    });
    if (mockState.errorApiName === apiName) {
      errCb({ apiName, message: "模拟官方 errCb" });
      return undefined;
    }

    let result;
    if (apiName === "mp_editor_get_isready") {
      result = { isReady: mockState.ready, isNew: mockState.isNew };
    } else if (apiName === "mp_editor_get_content") {
      result = { content: editor.innerHTML };
    } else if (apiName === "mp_editor_set_content") {
      editor.innerHTML = apiParam.content;
      result = { accepted: true, operation: apiName };
    } else if (apiName === "mp_editor_insert_html") {
      editor.insertAdjacentHTML("beforeend", apiParam.html);
      result = { accepted: true, operation: apiName, isSelect: apiParam.isSelect };
    } else {
      errCb({ message: "未知官方 API：" + apiName });
      return undefined;
    }

    if (mockState.neverCallbackApiName === apiName) return undefined;
    if (mockState.invokeReturnMode === "promise") return Promise.resolve(result);
    if (mockState.invokeReturnMode === "sync") return result;
    setTimeout(() => sucCb(result), 0);
    return undefined;
  }
};

function useDirectApi() {
  window.__MP_Editor_JSAPI__ = directApi;
  mockState.ready = true;
  mockState.isNew = true;
  mockState.invokeReturnMode = "callback";
  mockState.errorApiName = null;
  mockState.neverCallbackApiName = null;
  officialCalls.length = 0;
}

window.__MP_Editor_JSAPI__ = directApi;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function output(value) {
  document.getElementById("output").textContent = JSON.stringify(value, null, 2);
}

async function manual(type) {
  const payload = document.getElementById("payload").value;
  const isWrite = type === "set_content" || type === "insert_html";
  const read = isWrite ? await runMpOperation({ type: "read" }) : null;
  const command = !isWrite
    ? { type }
    : {
        type,
        html: payload,
        expectedBefore: read.content,
        confirmation: "WRITE_CURRENT_MP_EDITOR"
      };
  const result = await runMpOperation(command);
  const response = { result };
  if (result.ok && result.afterContent !== undefined) {
    response.diff = MpDiff.summarize(result.beforeContent, result.afterContent);
  }
  output(response);
}

async function runTests() {
  const results = [];
  const button = document.getElementById("run-tests");
  button.disabled = true;
  document.body.dataset.testStatus = "running";

  async function test(name, callback) {
    try {
      await callback();
      results.push({ name, status: "PASS" });
    } catch (error) {
      results.push({ name, status: "FAIL", error: error.message || String(error) });
    }
  }

  await test("检测 JSAPI、四个方法与 ready", async () => {
    const result = await runMpOperation({ type: "detect" });
    assert(result.ok && result.detected && result.ready, "检测失败");
    assert(Object.values(result.methods).every(Boolean), "方法列表不完整");
    assert(result.writeCalled === false, "检测不得写入");
  });

  await test("get_content 读取初始 HTML", async () => {
    const result = await runMpOperation({ type: "read" });
    assert(result.ok && result.content === editor.innerHTML, "读取内容不一致");
    assert(result.writeCalled === false, "读取不得写入");
  });

  await test("set_content 无人工确认时拒绝且不写", async () => {
    editor.innerHTML = initialContent;
    const result = await runMpOperation({ type: "set_content", html: "<p>禁止</p>" });
    assert(!result.ok && result.error.code === "MANUAL_CONFIRMATION_REQUIRED", "未拦截无确认写入");
    assert(!result.writeCalled && editor.innerHTML === initialContent, "内容被意外修改");
  });

  await test("insert_html 无人工确认时拒绝且不写", async () => {
    editor.innerHTML = initialContent;
    const result = await runMpOperation({ type: "insert_html", html: "<p>禁止</p>" });
    assert(!result.ok && result.error.code === "MANUAL_CONFIRMATION_REQUIRED", "未拦截无确认插入");
    assert(!result.writeCalled && editor.innerHTML === initialContent, "内容被意外修改");
  });

  await test("备份后内容漂移会阻止写入", async () => {
    editor.innerHTML = initialContent;
    const result = await runMpOperation({
      type: "set_content",
      html: "<p>不应写入</p>",
      expectedBefore: "过期备份",
      confirmation: "WRITE_CURRENT_MP_EDITOR"
    });
    assert(!result.ok && result.error.code === "CONTENT_CHANGED_BEFORE_WRITE", "未检测内容漂移");
    assert(!result.writeCalled && editor.innerHTML === initialContent, "漂移检查前内容被修改");
  });

  await test("set_content 单次写入、读回及文本/DOM 差异", async () => {
    editor.innerHTML = initialContent;
    const before = (await runMpOperation({ type: "read" })).content;
    const html = '<section><h2 id="set-marker">set 成功</h2><p>替换后的正文</p></section>';
    const result = await runMpOperation({
      type: "set_content",
      html,
      expectedBefore: before,
      confirmation: "WRITE_CURRENT_MP_EDITOR"
    });
    assert(result.ok && result.writeCalled, "set_content 未成功调用");
    assert(result.afterContent === editor.innerHTML && editor.querySelector("#set-marker"), "set 读回不一致");
    const diff = MpDiff.summarize(before, result.afterContent);
    assert(diff.changed && diff.text.changed && diff.dom.changed, "差异摘要未识别变化");
    assert(diff.dom.addedTags.h2 === 1 && diff.dom.addedTags.section === 1, "DOM 新增标签统计错误");
    assert(diff.text.firstDifference, "缺少首个文本差异位置");
  });

  await test("insert_html 插入、读回及追加差异", async () => {
    editor.innerHTML = initialContent;
    const before = (await runMpOperation({ type: "read" })).content;
    const result = await runMpOperation({
      type: "insert_html",
      html: '<p class="insert-marker">追加段落</p>',
      expectedBefore: before,
      confirmation: "WRITE_CURRENT_MP_EDITOR"
    });
    assert(result.ok && editor.querySelector(".insert-marker"), "insert_html 未插入");
    assert(result.afterContent.includes("原始内容") && result.afterContent.includes("追加段落"), "插入后内容不完整");
    const diff = MpDiff.summarize(before, result.afterContent);
    assert(diff.changed && diff.text.delta > 0 && diff.dom.elementDelta > 0, "插入差异统计错误");
    assert(diff.dom.addedTags.p === 1, "新增段落统计错误");
  });

  await test("写入后再次 get_content 读回一致", async () => {
    editor.innerHTML = initialContent;
    const before = editor.innerHTML;
    const written = await runMpOperation({
      type: "set_content",
      html: "<p>持久读回标记</p>",
      expectedBefore: before,
      confirmation: "WRITE_CURRENT_MP_EDITOR"
    });
    const read = await runMpOperation({ type: "read" });
    assert(written.ok && read.ok && read.content === written.afterContent, "再次读回不匹配");
  });

  await test("编辑器未就绪时读取和写入均被拒绝", async () => {
    editor.innerHTML = initialContent;
    mockState.ready = false;
    try {
      const read = await runMpOperation({ type: "read" });
      const write = await runMpOperation({
        type: "set_content",
        html: "<p>不应写入</p>",
        expectedBefore: initialContent,
        confirmation: "WRITE_CURRENT_MP_EDITOR"
      });
      assert(!read.ok && read.error.code === "NOT_READY", "未就绪读取未被拒绝");
      assert(!write.ok && write.error.code === "NOT_READY" && !write.writeCalled, "未就绪写入未被拒绝");
      assert(editor.innerHTML === initialContent, "未就绪时内容发生变化");
    } finally {
      mockState.ready = true;
    }
  });

  await test("API 缺失时检测返回 detected=false", async () => {
    const api = window.__MP_Editor_JSAPI__;
    try {
      delete window.__MP_Editor_JSAPI__;
      const result = await runMpOperation({ type: "detect" });
      assert(result.ok && result.detected === false && !result.writeCalled, "API 缺失检测错误");
    } finally {
      window.__MP_Editor_JSAPI__ = api;
    }
  });

  await test("支持 Promise 形式的 JSAPI 返回值", async () => {
    const api = window.__MP_Editor_JSAPI__;
    const original = api.get_content;
    try {
      api.get_content = () => Promise.resolve(original.call(api));
      const result = await runMpOperation({ type: "read" });
      assert(result.ok && result.content === editor.innerHTML, "Promise 返回值读取失败");
    } finally {
      api.get_content = original;
    }
  });

  await test("兼容 get_content 返回 content 字段对象", async () => {
    const api = window.__MP_Editor_JSAPI__;
    const original = api.get_content;
    try {
      api.get_content = () => ({ content: original.call(api) });
      const result = await runMpOperation({ type: "read" });
      assert(result.ok && result.content === editor.innerHTML, "对象形式内容读取失败");
    } finally {
      api.get_content = original;
    }
  });

  await test("相同内容的文本/DOM 差异为空", async () => {
    const diff = MpDiff.summarize(initialContent, initialContent);
    assert(!diff.changed && !diff.text.changed && !diff.dom.changed, "相同内容被误报为变化");
    assert(diff.text.firstDifference === null && diff.dom.elementDelta === 0, "空差异统计错误");
  });

  await test("官方 invoke 检测/读取使用完整签名与空对象参数", async () => {
    window.__MP_Editor_JSAPI__ = officialApi;
    officialCalls.length = 0;
    editor.innerHTML = initialContent;
    const detected = await runMpOperation({ type: "detect" });
    const read = await runMpOperation({ type: "read" });
    assert(detected.ok && detected.transport === "official-invoke" && detected.isNew === true, "官方检测未走 invoke");
    assert(detected.contentSupported && !detected.directMethods.get_content, "官方 mock 不应依赖 direct 方法");
    assert(read.ok && read.content === initialContent && read.transport === "official-invoke", "官方读取失败");
    assert(officialCalls[0].apiName === "mp_editor_get_isready", "检测的 ready API 名错误");
    assert(officialCalls[1].apiName === "mp_editor_get_isready", "读取前的 ready API 名错误");
    assert(officialCalls[2].apiName === "mp_editor_get_content", "官方 content API 名错误");
    assert(officialCalls.every((call) => call.hasCallbacks), "缺少 sucCb/errCb");
    assert(officialCalls.every((call) => Object.keys(call.apiParam).length === 0), "检测/读取参数必须为 {}");
    assert(!detected.writeCalled && !read.writeCalled, "官方检测/读取不得写入");
  });

  await test("官方 set_content 参数 {content}，写后读回且仅写一次", async () => {
    window.__MP_Editor_JSAPI__ = officialApi;
    editor.innerHTML = initialContent;
    officialCalls.length = 0;
    const before = (await runMpOperation({ type: "read" })).content;
    const result = await runMpOperation({
      type: "set_content",
      html: "<p>官方 set 标记</p>",
      expectedBefore: before,
      confirmation: "WRITE_CURRENT_MP_EDITOR"
    });
    const writes = officialCalls.filter((call) => call.apiName === "mp_editor_set_content");
    assert(result.ok && result.writeCalled && writes.length === 1, "官方 set 调用次数错误");
    assert(JSON.stringify(writes[0].apiParam) === JSON.stringify({ content: "<p>官方 set 标记</p>" }), "set 参数不是 {content}");
    assert(writes[0].hasCallbacks && result.afterContent.includes("官方 set 标记"), "官方 set 回调或读回失败");
  });

  await test("官方 insert_html 参数 {html,isSelect:false}，写后读回", async () => {
    window.__MP_Editor_JSAPI__ = officialApi;
    editor.innerHTML = initialContent;
    officialCalls.length = 0;
    const before = (await runMpOperation({ type: "read" })).content;
    const result = await runMpOperation({
      type: "insert_html",
      html: "<p>官方 insert 标记</p>",
      expectedBefore: before,
      confirmation: "WRITE_CURRENT_MP_EDITOR"
    });
    const writes = officialCalls.filter((call) => call.apiName === "mp_editor_insert_html");
    assert(result.ok && result.writeCalled && writes.length === 1, "官方 insert 调用次数错误");
    assert(JSON.stringify(writes[0].apiParam) === JSON.stringify({ html: "<p>官方 insert 标记</p>", isSelect: false }), "insert 参数错误");
    assert(writes[0].hasCallbacks && result.afterContent.includes("官方 insert 标记"), "官方 insert 回调或读回失败");
  });

  await test("官方 isNew=false 阻止 get_content/set/insert 且不写", async () => {
    window.__MP_Editor_JSAPI__ = officialApi;
    editor.innerHTML = initialContent;
    mockState.isNew = false;
    officialCalls.length = 0;
    try {
      const detected = await runMpOperation({ type: "detect" });
      const read = await runMpOperation({ type: "read" });
      const write = await runMpOperation({
        type: "set_content",
        html: "<p>旧版禁止写入</p>",
        expectedBefore: initialContent,
        confirmation: "WRITE_CURRENT_MP_EDITOR"
      });
      assert(detected.ok && detected.ready && detected.isNew === false && !detected.contentSupported, "旧版能力检测错误");
      assert(!read.ok && read.error.code === "LEGACY_EDITOR_UNSUPPORTED", "旧版读取未被阻断");
      assert(!write.ok && write.error.code === "LEGACY_EDITOR_UNSUPPORTED" && !write.writeCalled, "旧版写入未被阻断");
      assert(!officialCalls.some((call) => ["mp_editor_get_content", "mp_editor_set_content", "mp_editor_insert_html"].includes(call.apiName)), "旧版仍调用了受限 API");
      assert(editor.innerHTML === initialContent, "旧版内容被修改");
    } finally {
      mockState.isNew = true;
    }
  });

  await test("官方 errCb 成为错误；写失败保留 writeCalled 且不自动重试", async () => {
    window.__MP_Editor_JSAPI__ = officialApi;
    editor.innerHTML = initialContent;
    officialCalls.length = 0;
    mockState.errorApiName = "mp_editor_get_content";
    const read = await runMpOperation({ type: "read" });
    assert(!read.ok && read.error.code === "JSAPI_CALL_FAILED" && !read.writeCalled, "官方读取 errCb 未传播");
    mockState.errorApiName = "mp_editor_set_content";
    const write = await runMpOperation({
      type: "set_content",
      html: "<p>失败写入</p>",
      expectedBefore: initialContent,
      confirmation: "WRITE_CURRENT_MP_EDITOR"
    });
    const writes = officialCalls.filter((call) => call.apiName === "mp_editor_set_content");
    assert(!write.ok && write.error.code === "JSAPI_CALL_FAILED" && write.writeCalled, "官方写入 errCb 状态错误");
    assert(writes.length === 1 && editor.innerHTML === initialContent, "写失败后发生重试或意外修改");
    mockState.errorApiName = null;
  });

  await test("官方 invoke 无回调且无返回值时按超时失败", async () => {
    window.__MP_Editor_JSAPI__ = officialApi;
    mockState.neverCallbackApiName = "mp_editor_get_content";
    try {
      const result = await runMpOperation({ type: "read", timeoutMs: 20 });
      assert(!result.ok && result.error.code === "API_TIMEOUT" && !result.writeCalled, "官方回调超时未被处理");
    } finally {
      mockState.neverCallbackApiName = null;
    }
  });

  await test("官方 invoke 同时兼容 Promise 与同步返回", async () => {
    window.__MP_Editor_JSAPI__ = officialApi;
    mockState.invokeReturnMode = "promise";
    const promised = await runMpOperation({ type: "read" });
    assert(promised.ok && promised.content === editor.innerHTML, "官方 Promise 返回读取失败");
    mockState.invokeReturnMode = "sync";
    const synchronous = await runMpOperation({ type: "read" });
    assert(synchronous.ok && synchronous.content === editor.innerHTML, "官方同步返回读取失败");
    mockState.invokeReturnMode = "callback";
  });

  await test("移除 invoke 后仍回退 direct/Promise", async () => {
    useDirectApi();
    const direct = await runMpOperation({ type: "read" });
    assert(direct.ok && direct.transport === "direct" && direct.content === initialContent, "direct 回退失败");
    const original = directApi.get_content;
    directApi.get_content = () => Promise.resolve(original.call(directApi));
    try {
      const promised = await runMpOperation({ type: "read" });
      assert(promised.ok && promised.transport === "direct" && promised.content === initialContent, "direct Promise 回退失败");
    } finally {
      directApi.get_content = original;
    }
  });

  editor.innerHTML = initialContent;
  useDirectApi();
  const failed = results.filter((result) => result.status === "FAIL");
  const report = [
    `${failed.length ? "FAIL" : "PASS"} ${results.length - failed.length}/${results.length}`,
    ...results.map((result) => `${result.status === "PASS" ? "✓" : "✗"} ${result.name}${result.error ? " — " + result.error : ""}`)
  ].join("\n");
  document.getElementById("test-results").textContent = report;
  document.body.dataset.testStatus = failed.length ? "failed" : "passed";
  window.__MP_POC_TEST_RESULTS__ = results;
  window.__MP_POC_TEST_DONE__ = true;
  button.disabled = false;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("api-mode").addEventListener("change", (event) => {
    if (event.target.value === "official") {
      window.__MP_Editor_JSAPI__ = officialApi;
      mockState.isNew = true;
      officialCalls.length = 0;
    } else {
      useDirectApi();
    }
    output({ apiMode: event.target.value, note: "切换仅影响本地 mock" });
  });
  document.getElementById("detect").addEventListener("click", () => manual("detect"));
  document.getElementById("read").addEventListener("click", () => manual("read"));
  document.getElementById("set").addEventListener("click", () => manual("set_content"));
  document.getElementById("insert").addEventListener("click", () => manual("insert_html"));
  document.getElementById("run-tests").addEventListener("click", runTests);
  if (new URLSearchParams(location.search).has("autorun")) runTests();
});
