// stdout/stderr EPIPE 兜底 —— 修复反复弹出的
// "A JavaScript error occurred in the main process / Error: EPIPE: broken pipe, write" 对话框。
//
// 原因说明：
// 1. 热点模块依赖 dailyhot-api，其内部自带 winston 日志库，会向 stdout（控制台）写日志；
// 2. 应用通过「启动心流.bat」启动时，bat 的控制台窗口随脚本退出而关闭，
//    应用继承的 stdout 管道随之失效（读取端消失）；
// 3. 此后 winston 每写一条日志，写入都会收到 EPIPE（管道断裂）。
//    stdout 上没有 error 监听器时，Node 会把该错误当作未捕获异常抛出，
//    Electron 主进程便弹出错误对话框——即"每次记日志弹一次窗"的现象。
//
// 修复方式：尽早给 process.stdout / process.stderr 挂上 error 监听器，
// 把 EPIPE 在流层面拦截掉（仅吞掉 EPIPE，其余错误照常抛出，不掩盖真实缺陷）。
// 本模块必须作为主进程入口的第一个 import，保证先于 dailyhot-api/winston 生效。

type PipeLikeStream = {
  on?: (event: 'error', listener: (err: NodeJS.ErrnoException) => void) => unknown
} | null | undefined

function ignoreBrokenPipe(stream: PipeLikeStream): void {
  // 通过「启动心流.bat」以纯 GUI 方式拉起时 stdout 可能为 null，
  // 个别环境下 on 方法也可能缺失，故两处均做可选保护
  stream?.on?.('error', (err) => {
    if (err.code === 'EPIPE') return
    throw err
  })
}

ignoreBrokenPipe(process.stdout)
ignoreBrokenPipe(process.stderr)
