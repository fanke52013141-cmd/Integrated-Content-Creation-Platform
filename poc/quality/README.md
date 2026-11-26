# 官方文章结构校验 POC

本目录只封装并记录上游官方校验器，不修改上游规则，也不把“通过”解释为完整规范合规。

## 锁定环境

| 项目 | 值 |
|---|---|
| 上游 | `upstream/verify-article-structure-spec/cli` |
| CLI 版本 | `verify-article-structure@0.2.30` |
| 上游锁文件 | `pnpm-lock.yaml`，`lockfileVersion: '6.0'` |
| 兼容包管理器 | 本目录 `.tools` 内的 `pnpm@8.15.9` |
| Node | `v24.21.0` |
| Chromium | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| 浏览器选择 | 显式 `PUPPETEER_EXECUTABLE_PATH` / `--executable-path`，未依赖 Puppeteer 自带下载 |

当前 pnpm 11 首次执行 `install --ignore-workspace --frozen-lockfile` 返回 **1**，因为不支持上游 lockfileVersion 6.0。未使用会重写锁文件的 `--force`，改为在本目录安装 pnpm 8 后成功安装，退出码 **0**。Puppeteer 浏览器下载长期无进展后，按上游文档以 `PUPPETEER_SKIP_DOWNLOAD=true` 完成依赖安装并使用系统 Chrome。

## 已执行结果

| 命令/用例 | 退出码 | 结果 | 记录 |
|---|---:|---|---|
| 原始官方 `probe` | 0 | 通过；收集阶段 `caret-color` 与布局阶段 `height-nodisplay` 均跑通，无“布局规则跳过”告警 | [official-probe.json](results/official-probe.json) |
| 原始官方 `check e2e-violations.html --json` | 1 | 符合预期；`isValid=false`，命中 `height-nodisplay`、`caret-color` | [official-e2e-violations.json](results/official-e2e-violations.json) |
| 原始官方 `check e2e-clean.html --json` | 0 | 符合预期；`isValid=true`，`violations=[]` | [official-e2e-clean.json](results/official-e2e-clean.json) |
| 本目录 `run-official.mjs` 复跑以上三项 | 0 | `allPassed=true` | [official-summary.json](results/official-summary.json) |
| 独立 `verify.mjs` clean smoke | 0 | `outcome=valid`，生成可复用 JSON | [wrapper-clean-smoke.json](results/wrapper-clean-smoke.json) |
| 主测试文章 `poc/artifacts/article-fragment.html` | 0 | `outcome=valid`，`isValid=true`，`violations=[]`；仅表示已实现规则通过 | [main-article.json](results/main-article.json) |
| 补充官方 `test:e2e` | 1 | Windows 测试启动器不兼容，6 个用例均在进入 CLI/Chromium 前返回 2；**不是规则回归失败** | [official-e2e-windows.json](results/official-e2e-windows.json) |

Windows E2E 限制的证据：`tests/cli.test.ts` 直接 `execFileSync(node_modules/.bin/tsx)`，而 pnpm 生成的无扩展名 `tsx` 是 `#!/bin/sh` POSIX shim；同目录另有 Windows 用的 `tsx.CMD` / `tsx.ps1`。本 POC 不改上游测试，包装与官方 E2E 一样直接调用 `tsx/dist/cli.mjs`，因此得到纯 JSON stdout。

## 复现命令

以下是本次实际使用的路径与命令（PowerShell）：

```powershell
$root = 'D:\Program Files (x86)\Integrated-Content-Creation-Platform'
$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm8 = "$root\poc\quality\.tools\node_modules\pnpm\bin\pnpm.cjs"
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$cli = "$root\upstream\verify-article-structure-spec\cli"

# 首次准备兼容包管理器（已在 poc/quality 内完成）
npm install --prefix "$root\poc\quality\.tools" pnpm@8.15.9 --no-audit --no-fund

# 安装上游锁定依赖；不重写上游锁文件
Push-Location $cli
$env:PUPPETEER_SKIP_DOWNLOAD = 'true'
& $node $pnpm8 install --ignore-workspace --frozen-lockfile   # 0

# 先跑原始官方 probe / fixture
$env:PUPPETEER_EXECUTABLE_PATH = $chrome
& $node $pnpm8 probe                                           # 0
& $node $pnpm8 check "$cli\tests\fixtures\e2e-violations.html" --json  # 1（预期违规）
& $node $pnpm8 check "$cli\tests\fixtures\e2e-clean.html" --json       # 0
Pop-Location

# 用 JSON 包装复跑官方三项并生成 summary
& $node "$root\poc\quality\run-official.mjs" "--executable-path=$chrome"  # 0
```

## 接入主测试文章

主测试文章已按以下命令接入：

```powershell
& $node "$root\poc\quality\verify.mjs" "$root\poc\artifacts\article-fragment.html" `
  "--out=$root\poc\quality\results\main-article.json" `
  "--executable-path=$chrome"  # 0，isValid=true，violations=[]
```

包装退出码与官方一致：

- `0`：已实现规则未发现违规，`outcome=valid`；
- `1`：发现违规，`outcome=violations`，这不是执行异常；
- `2`：浏览器、进程、输入或 JSON 解析异常，`outcome=error`。

输出路径必须位于 `poc/quality` 内，防止包装写出独占范围。每份记录包含：

- 上游版本、锁文件版本、pnpm/Node 版本；
- Chromium 绝对路径及是否存在；
- 实际可执行文件、参数、工作目录、原始退出码与包装退出码；
- 解析后的官方 `result`、原始 stdout/stderr、解析/启动错误；
- 已知未覆盖规则。

## 已知未覆盖规则

以下直接来自上游 `cli/README.md` 的明确声明，并已写入每份 JSON：

1. 规范第 3 章字体检测尚未接入；
2. 规范第 2.2 节 `span[leaf]` 结构检测尚未接入；
3. 规范第 2.3 节 `section[nodeleaf]` 结构检测尚未接入；
4. `redundant-node` 仅预留文案和跳过用例，尚未纳入规范或实现检测。

因此，官方 fixture/probe 通过只证明工具链可用；即使后续主文章返回 `isValid=true`，也不能宣称覆盖完整规范。Puppeteer 21 在当前 Chrome 上会输出 old Headless deprecation warning，目前不影响退出码或检测结果。
