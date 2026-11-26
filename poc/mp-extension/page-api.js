/*
 * Executed in the page's MAIN world by chrome.scripting.executeScript.
 * Keep runMpOperation self-contained: Chrome serializes only this function.
 * The same function is loaded by mock/index.html for local integration tests.
 */
async function runMpOperation(command) {
  const operation = command && command.type;
  const timeoutMs = command && Number.isFinite(command.timeoutMs)
    ? Math.max(1, command.timeoutMs)
    : 8000;
  let writeCalled = false;

  function failure(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  function describeValue(value) {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string") return value.slice(0, 500);
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    try {
      return JSON.stringify(value).slice(0, 500);
    } catch (_) {
      return Object.prototype.toString.call(value);
    }
  }

  function transportOf(api) {
    if (api && typeof api.invoke === "function") return "official-invoke";
    if (api && typeof api.get_isready === "function") return "direct";
    return "none";
  }

  function isReady(value) {
    if (value === true || value === 1 || value === "1" || value === "true") return true;
    if (value && typeof value === "object") {
      return value.isready === true || value.isReady === true || value.ready === true;
    }
    return false;
  }

  function isNewValue(value) {
    return value && typeof value === "object" && typeof value.isNew === "boolean"
      ? value.isNew
      : null;
  }

  function capabilities(readyValue, transport) {
    const ready = isReady(readyValue);
    const isNew = isNewValue(readyValue);
    return {
      ready,
      isNew,
      // Direct mocks predate isNew; official content APIs require isNew=true.
      contentSupported: ready && isNew !== false &&
        (transport === "direct" || (transport === "official-invoke" && isNew === true))
    };
  }

  function requireContentAccess(readyValue, transport) {
    const capability = capabilities(readyValue, transport);
    if (!capability.ready) {
      failure("NOT_READY", "get_isready 未明确返回就绪；实际值：" + describeValue(readyValue));
    }
    if (capability.isNew === false) {
      failure(
        "LEGACY_EDITOR_UNSUPPORTED",
        "当前为旧版编辑器（isNew=false），官方内容读写 API 不可用；未执行 get_content 或写入"
      );
    }
    if (transport === "official-invoke" && capability.isNew !== true) {
      failure(
        "EDITOR_CAPABILITY_UNKNOWN",
        "官方 get_isready 未明确返回 isNew=true，为安全起见不执行内容读写"
      );
    }
  }

  function contentString(value) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      for (const key of ["content", "html", "contentHtml", "content_html"]) {
        if (typeof value[key] === "string") return value[key];
      }
      if (value.data && value.data !== value) return contentString(value.data);
    }
    failure(
      "INVALID_CONTENT_RESPONSE",
      "get_content 未返回 HTML 字符串或包含 content/html 字段的对象；实际值：" + describeValue(value)
    );
  }

  function settle(method, executor, undefinedIsSyncResult) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error(method + " 调用超过 " + timeoutMs + "ms（未收到回调或有效返回值）");
        error.code = "API_TIMEOUT";
        reject(error);
      }, timeoutMs);

      function succeed(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }

      function fail(reason) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = reason instanceof Error
          ? reason
          : new Error(method + " 返回错误：" + describeValue(reason));
        if (!error.code) error.code = "JSAPI_CALL_FAILED";
        reject(error);
      }

      try {
        const returned = executor(succeed, fail);
        if (returned && typeof returned.then === "function") {
          Promise.resolve(returned).then(succeed, fail);
        } else if (returned !== undefined || undefinedIsSyncResult) {
          succeed(returned);
        }
        // Official undefined returns remain pending until sucCb/errCb or timeout.
      } catch (error) {
        fail(error);
      }
    });
  }

  function officialParam(method, html) {
    if (method === "set_content") return { content: html };
    if (method === "insert_html") return { html, isSelect: false };
    return {};
  }

  async function callApi(api, method, html) {
    const transport = transportOf(api);
    if (transport === "official-invoke") {
      return settle(
        method,
        (sucCb, errCb) => api.invoke({
          apiName: "mp_editor_" + method,
          apiParam: officialParam(method, html),
          sucCb,
          errCb
        }),
        false
      );
    }
    if (transport === "direct") {
      if (typeof api[method] !== "function") {
        failure("METHOD_NOT_FOUND", "direct JSAPI 缺少方法：" + method);
      }
      const args = method === "set_content" || method === "insert_html" ? [html] : [];
      return settle(method, () => api[method](...args), true);
    }
    failure("API_NOT_FOUND", "未发现可调用的 window.__MP_Editor_JSAPI__.invoke 或 direct 方法");
  }

  try {
    if (!["detect", "read", "set_content", "insert_html"].includes(operation)) {
      failure("UNKNOWN_OPERATION", "未知操作：" + describeValue(operation));
    }

    const isWrite = operation === "set_content" || operation === "insert_html";
    if (isWrite && command.confirmation !== "WRITE_CURRENT_MP_EDITOR") {
      failure("MANUAL_CONFIRMATION_REQUIRED", "写入需要人工确认令牌");
    }
    if (isWrite && typeof command.html !== "string") {
      failure("INVALID_HTML", "写入内容必须是字符串");
    }

    const api = window.__MP_Editor_JSAPI__;
    const transport = transportOf(api);
    const methodNames = ["get_isready", "get_content", "set_content", "insert_html"];
    const directMethods = Object.fromEntries(
      methodNames.map((name) => [name, Boolean(api && typeof api[name] === "function")])
    );
    const methods = Object.fromEntries(
      methodNames.map((name) => [name, directMethods[name] || transport === "official-invoke"])
    );

    if (operation === "detect") {
      if (!api || transport === "none") {
        return {
          ok: true,
          operation,
          detected: false,
          transport,
          officialInvoke: transport === "official-invoke",
          directMethods,
          methods,
          ready: false,
          isNew: null,
          contentSupported: false,
          url: location.href,
          writeCalled: false
        };
      }
      const readyValue = await callApi(api, "get_isready");
      const capability = capabilities(readyValue, transport);
      return {
        ok: true,
        operation,
        detected: true,
        transport,
        officialInvoke: transport === "official-invoke",
        directMethods,
        methods,
        ready: capability.ready,
        isNew: capability.isNew,
        contentSupported: capability.contentSupported,
        readyRaw: describeValue(readyValue),
        url: location.href,
        writeCalled: false
      };
    }

    if (!api) failure("API_NOT_FOUND", "未发现 window.__MP_Editor_JSAPI__");
    const readyValue = await callApi(api, "get_isready");
    requireContentAccess(readyValue, transport);
    const capability = capabilities(readyValue, transport);

    if (operation === "read") {
      const content = contentString(await callApi(api, "get_content"));
      return {
        ok: true,
        operation,
        detected: true,
        transport,
        officialInvoke: transport === "official-invoke",
        directMethods,
        methods,
        ready: true,
        isNew: capability.isNew,
        contentSupported: true,
        content,
        url: location.href,
        writeCalled: false
      };
    }

    const beforeContent = contentString(await callApi(api, "get_content"));
    if (typeof command.expectedBefore !== "string") {
      failure("BACKUP_REQUIRED", "写入前必须提供已持久化备份的内容用于漂移检查");
    }
    if (beforeContent !== command.expectedBefore) {
      failure(
        "CONTENT_CHANGED_BEFORE_WRITE",
        "备份后编辑器内容已变化，已取消写入；请重新读取并备份"
      );
    }

    writeCalled = true;
    const writeResult = await callApi(api, operation, command.html);
    const afterContent = contentString(await callApi(api, "get_content"));

    return {
      ok: true,
      operation,
      detected: true,
      transport,
      officialInvoke: transport === "official-invoke",
      directMethods,
      methods,
      ready: true,
      isNew: capability.isNew,
      contentSupported: true,
      beforeContent,
      afterContent,
      writeResult: describeValue(writeResult),
      url: location.href,
      writeCalled
    };
  } catch (error) {
    return {
      ok: false,
      operation,
      writeCalled,
      error: {
        code: error.code || "PAGE_OPERATION_FAILED",
        message: error && error.message ? error.message : String(error)
      }
    };
  }
}
