# POC 依赖与许可证清单

> 这是技术 POC 的关键依赖清单，不替代正式法律审查或完整传递依赖 SBOM。完整版本约束以两个上游仓库的锁文件为准。

## 直接上游

| 组件 | 锁定版本/提交 | 许可证 | 用途与注意 |
|---|---|---|---|
| `doocs/md` | `80b43d495bf51ce5d70dcfb0d73443b306104e76`，根包 2.1.0、MCP 2.1.1 | WTFPL（见 `upstream/doocs-md/LICENSE`） | 编辑器、renderer、主题、juice 与微信复制链路；第三方依赖、Logo、字体、图片和主题资产需另审 |
| `wechatjs/verify-article-structure-spec` | `c04fb843fd678e5806bda9cae190e913224caa49`，CLI 0.2.30 | MIT（见 `upstream/verify-article-structure-spec/LICENSE`） | 官方文章结构规范、测试用例和 Puppeteer checker；保留版权与许可文本 |

## 主要运行依赖

| 依赖 | 版本来源 | 用途 |
|---|---|---|
| Node.js | 主链路 v24.12.0；官方 checker 包装 v24.21.0 | 执行 TS/JS 与本地 API 适配 |
| Chromium / Google Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` | 真实浏览器渲染、官方布局检测和 MP mock |
| `marked` | `upstream/doocs-md/pnpm-lock.yaml` | Markdown token 与 renderer |
| `juice` | `upstream/doocs-md/pnpm-lock.yaml` | CSS 内联 |
| `isomorphic-dompurify` | `upstream/doocs-md/pnpm-lock.yaml` | 上游 HTML 清洗；不替代 POC 最终安全检查 |
| `jsdom` | `upstream/doocs-md/pnpm-lock.yaml` | 本地 DOM 差异、素材替换和测试，不承担 SVG 几何渲染 |
| `puppeteer` | `upstream/verify-article-structure-spec/cli/pnpm-lock.yaml` | 驱动真实 Chromium |
| `verify-article-structure` | 0.2.30 | 官方结构检查 |
| `pnpm` | doocs 12.23.0；checker 8.15.9 | 匹配两个上游锁文件与工作区要求 |
| Pillow | 当前工作区 Python 环境 | 生成确定性 POC 测试图片 |

## 自有 POC 文件

`poc/scripts`、`poc/server`、`poc/quality` 和 `poc/mp-extension` 为本项目 POC 适配代码。没有直接并入 GPL/AGPL/BUSL 项目代码，没有使用付费 md2wechat API，也没有接入任何自动发布或群发能力。

## 凭证与产物

- `poc/.runtime/wechat.env` 被 `.gitignore` 排除；不得在日志中输出 AppSecret、access_token 或 Cookie。
- `poc/artifacts/` 包含可再生成的文章、校验与 mock 结果；真实账号结果可能含内部信息，公开分享前应脱敏。
- 测试图片为本 POC 程序生成，不使用第三方模板或摄影素材。
