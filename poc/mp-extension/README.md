# MP JSAPI 人工写入读回 POC

Manifest V3 扩展，用于验证微信公众号编辑器页面中的 `window.__MP_Editor_JSAPI__`：

- 检测 `get_isready` / `get_content` / `set_content` / `insert_html`；
- 优先适配[微信官方 `invoke` 签名](https://developers.weixin.qq.com/doc/service/guide/product/mp_editor_jsapi.html)，无 `invoke` 时保留 direct/Promise 兼容；
- 人工读取并备份；
- 人工触发一次 `set_content` 或 `insert_html`；
- 写入前持久化备份、备份后内容漂移检查；
- 写入后再次 `get_content` 读回；
- 输出文本长度、首个文本差异、DOM 元素数和新增/移除标签摘要。

## 安全边界

- **没有常驻 content script、没有轮询、没有自动写入。**
- 仅声明 `activeTab`、`scripting`、`storage`，不声明宽泛的 host permissions。
- 只有用户打开扩展并点击具体操作后，service worker 才通过 `chrome.scripting.executeScript` 在当前标签页的 MAIN world 调用一次 `runMpOperation`。
- URL 仅允许 `https://mp.weixin.qq.com/*` 和 localhost/127.0.0.1 mock。
- 每次写入都必须输入“写入”，且扩展会先重新读取并把备份保存到 `chrome.storage.local`。备份保存失败会中止写入。
- 写入前再次读取当前内容，并与刚保存的备份做精确比较；内容发生变化则取消。
- 每个标签页最多保留最近 5 份备份。备份含草稿正文，保存在本机扩展存储中；不再需要时可清除该扩展的网站数据。
- 写入后只读回一次；若 API 已调用但读回失败，会提示人工核验，**不会自动重试写入**。
- 官方通道仅在 `get_isready` 返回 `isReady=true, isNew=true` 时允许内容读写；`isNew=false` 会明确阻断 `get_content` 和写入，需由用户改用人工复制流程。

> 这是 POC，不是生产发布工具。真实页面请只在可丢弃的测试草稿中验证。`set_content` 的语义是替换全文。不同公众号后台版本的 JSAPI 行为可能变化。

## 安装扩展

1. 使用支持 Manifest V3 和 MAIN world scripting 的 Chrome/Edge（Chrome 111+）。
2. 打开 `chrome://extensions` 或 `edge://extensions`。
3. 开启“开发者模式”。
4. 选择“加载已解压的扩展程序”，目录选择本目录：`poc/mp-extension`。
5. 打开目标页面，点击浏览器工具栏中的 **MP JSAPI 人工写入 POC**。

## 启动本地 mock

在此目录运行任意静态 HTTP 服务，例如：

```powershell
python -m http.server 8765
```

然后打开：

```text
http://127.0.0.1:8765/mock/
```

mock 自身定义了一个基于 DOM 的假 `window.__MP_Editor_JSAPI__`，不会访问真实公众号。页面可切换 direct 与“只有 invoke、没有 direct 方法”的官方回调形态。可直接使用页面按钮，也可安装扩展后在 mock 标签页打开扩展 popup，验证完整消息链路和本地备份。

### 推荐人工验证顺序

1. 点击 **检测 JSAPI**：只检测对象/方法并调用 `get_isready`。
2. 点击 **读取并备份**：确认就绪，调用 `get_content`，保存备份。
3. 选择 `set_content` 或 `insert_html`，编辑 HTML。
4. 输入确认文字 **写入**。
5. 点击 **备份后执行一次写入并读回**。
6. 检查 mock 编辑器、备份 ID、读回长度及文本/DOM 差异摘要。
7. 点击 **读回并比较**，可再次核对最近一次写入前基线。

## 自动化 mock 测试

在 mock 页面点击 **运行全部测试**，或访问：

```text
http://127.0.0.1:8765/mock/?autorun=1
```

测试只操作 mock DOM，覆盖：

1. API/方法检测与 ready；
2. `get_content` 读取；
3. 无人工确认时 set/insert 均拒绝且不修改内容；
4. 备份后内容漂移时拒绝写入；
5. `set_content` 写入、读回与文本/DOM 差异；
6. `insert_html` 插入、读回与追加差异；
7. 写入后再次读回一致；
8. 未就绪时拒绝读取/写入；
9. API 缺失检测；
10. Promise 形式的 JSAPI 返回值；
11. `get_content` 返回 `{ content: string }` 的兼容处理；
12. 相同内容的空差异；
13. 官方 invoke 的 API 名、空对象参数及 sucCb/errCb；
14. 官方 `set_content` 的 `{content}` 与单次写入读回；
15. 官方 `insert_html` 的 `{html,isSelect:false}` 与读回；
16. `isNew=false` 时阻断受限 API；
17. 官方 errCb、写失败状态及不自动重试；
18. 官方无回调/无返回值时的超时；
19. 官方 Promise 与同步返回；
20. 移除 invoke 后的 direct/Promise 回退。

页面通过 `<body data-test-status="passed|failed">` 和测试报告暴露结果。

也可在安装了 Chrome/Edge 的机器上直接对本地 HTML 做 headless 测试（将路径替换为实际路径）：

```powershell
msedge --headless --disable-gpu --virtual-time-budget=5000 --dump-dom "file:///D:/path/to/poc/mp-extension/mock/index.html?autorun=1"
```

检查输出中的 `data-test-status="passed"` 和 `PASS 21/21`。

### Service worker 消息链测试

使用 Node.js 内置测试运行器，无第三方依赖：

```powershell
node --test test/background.test.js
```

7 项测试使用模拟的 Chrome API 和 MP JSAPI，覆盖启动无页面执行、人工确认、备份先于写入、内容漂移、读回基线选择、写后状态保存失败警示及 URL 白名单。该测试不替代浏览器中的扩展加载实测，更不会访问真实公众号。

## 文件结构

```text
manifest.json       MV3 配置；无 content_scripts / host_permissions
background.js       人工消息、URL 检查、持久备份、调用和读回编排
page-api.js         MAIN world JSAPI 适配器；亦供 mock 测试复用
popup.html/.js/.css 人工操作界面与差异展示
diff.js             文本/DOM 差异摘要
mock/               独立模拟页面及 21 项浏览器测试（含 8 项官方/回退测试）
test/               7 项 service worker 消息链测试（Node.js 内置 runner）
```

## 已知 POC 假设

- 官方通道调用 `invoke({apiName,apiParam,sucCb,errCb})`：读取参数为 `{}`，set 为 `{content}`，insert 为 `{html,isSelect:false}`。支持回调、Promise、同步返回及 8 秒超时；回调与返回值同时存在时只接受首个完成结果。
- direct 通道保留原 `get_isready()`、`get_content()`、`set_content(html)`、`insert_html(html)` 形式，支持同步值、Promise 及同步 `undefined` 返回。
- `get_content` 主要按 HTML 字符串处理，也兼容 `content`、`html`、`contentHtml`、`content_html` 字段及嵌套 `data`。
- `get_isready` 接受 `true`、`1`、`"1"`、`"true"` 或常见对象布尔字段；其他值一律视为未就绪。官方内容 API 必须额外满足 `isNew=true`；direct 兼容仅在未提供 `isNew` 或其为 `true` 时可用。
- DOM 差异是摘要而非完整补丁：规范化空白后比较文本/标签/属性，并统计元素标签增减；不生成可应用的 DOM patch。
