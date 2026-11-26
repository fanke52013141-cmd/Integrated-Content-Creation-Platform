# WeChat Theme Compiler

版本化、确定性、可实际接入 doocs 的原创微信公众号主题包。不是设计稿：每套主题均由 JSON tokens 和组件规则编译为可直接放入 `#md-theme` 的 `#output` CSS。

## 三套主题

| ID | 名称 | 视觉特征 |
| --- | --- | --- |
| `tech-blue` | 科技蓝 | 深海军蓝刊头、青色信号线、浅蓝信息卡、深蓝代码台 |
| `editorial-red` | 编辑红 | 朱砂刊头、暖纸底色、金色书腰线、系统衬线标题 |
| `jade-notes` | 翡翠笔记 | 翡翠边线、圆角手账卡、嫩叶色标记、琥珀注释 |

每套包含 33 组组件规则：H1–H6、正文、链接、粗体、斜体、删除线、引用、提示块、列表、表头/单元格/隔行、代码块/行内代码、图片、图注、分割线、卡片、注释/脚注、高亮和下划线。只使用系统字体，无外部图片、字体、脚本或其他网络资产。

## 使用

```js
import {
  compileRegisteredTheme,
  getTheme,
  listThemes
} from '@integrated-content/wechat-theme'

console.log(listThemes())
const css = compileRegisteredTheme('tech-blue', '1.0.0')
```

也支持显式版本注册与解析：

```js
import { compileTheme, createThemeRegistry } from '@integrated-content/wechat-theme'

const registry = createThemeRegistry()
registry.register(themeJson)
const theme = registry.resolve('theme-id', 'latest')
const css = compileTheme(theme)
```

- 主题和规则均有稳定 ID；主题版本使用 `major.minor.patch`。
- 注册表支持同一 ID 多版本共存，latest 按数字段比较而非字符串比较。
- 编译器拒绝未知 token、schema 主版本不兼容、重复规则名和非 `#output` 作用域。
- 声明属性按名称排序；规则顺序和选择器顺序固定保留；无时间戳和随机输入，重复编译字节一致。

## doocs / processClipboardContent 接入

doocs 的主题应用器接受自定义 CSS；本包输出已经带 `#output`，因此不会被重复添加作用域：

```js
import { compileRegisteredTheme } from '@integrated-content/wechat-theme'

const css = compileRegisteredTheme('jade-notes')
document.querySelector('#md-theme').textContent = css
```

也可以将 `css` 传给 doocs `applyTheme` 的 `themeCSS`。实际 `processClipboardContent` 会：

1. 从 `#md-theme` 读取 CSS；
2. 将 `#output {}` 转为 `body {}`，移除后代选择器的 `#output`；
3. 通过 juice 使用 `inlinePseudoElements: true`、`preserveImportant: true`、`resolveCSSVariables: false` 内联；
4. 继续执行微信 DOM/SVG/图片处理。

本包测试复刻第 2、3 步并调用 juice 12.2.6 验证，而不是只检查 CSS 字符串。

## 微信输出约束

最终 CSS 禁止：

- `@font-face`、`@import`、`url()`、脚本和可执行 CSS；
- `var()` 与最终自定义属性；
- grid、float；
- absolute/fixed/sticky 定位；
- animation、transition、keyframes。

层次通过颜色、留白、边框、圆角、轻阴影、卡片、表格、引用及代码块形成。代码采用可换行的 `pre-wrap`，避免依赖复杂布局。

## 构建与测试

```powershell
node scripts/build.mjs
node --test tests/*.test.js
```

或：

```powershell
npm test
```

构建输出位于 `dist/`，不包含时间戳。测试覆盖注册表、版本选择、确定性、token 解析、安全阻断、组件覆盖、构建产物一致性以及三套主题的真实 juice 内联。

`juice` 是本包 devDependency；当前工作区测试也可直接复用 `upstream/doocs-md` 已安装的 12.2.6。

## 自定义组件

- `.wechat-card` / `.wechat-card-title`：内容卡片及标题。
- `.wechat-callout`：提示/强调块。
- `.wechat-note`：辅助注释。
- 同时兼容 doocs 的 `.markdown-alert`、`.code__pre`、`.code-block`、`.codespan`、`.code-inline`、`.md-figcaption`、`.markup-highlight` 等类名。

JSON Schema 位于 `schema/theme.schema.json`。编译器内置与 schema 对应的运行时校验，因此无需依赖 schema 校验库即可安全编译。
