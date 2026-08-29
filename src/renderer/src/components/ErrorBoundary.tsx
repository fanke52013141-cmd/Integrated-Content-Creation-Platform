import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  errorInfo: ErrorInfo | null
  /** 每次 "重试" 递增，用于强制子树重新挂载 */
  retryKey: number
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, errorInfo: null, retryKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 写入状态供 UI 展示；同时输出到开发者控制台
    console.error('[ErrorBoundary]', error, errorInfo)
    this.setState({ errorInfo })
  }

  private readonly handleReload = (): void => {
    window.location.reload()
  }

  private readonly handleRetry = (): void => {
    this.setState((prev) => ({ error: null, errorInfo: null, retryKey: prev.retryKey + 1 }))
  }

  override render(): ReactNode {
    const { error, errorInfo, retryKey } = this.state

    if (!error) {
      return <div key={retryKey}>{this.props.children}</div>
    }

    const stack = errorInfo?.componentStack ?? error.stack ?? ''

    return (
      <div className="boot-screen error-state error-boundary-fallback">
        <span className="boot-mark">!</span>
        <h1>页面渲染出错</h1>
        <p className="error-boundary-message">{error.message}</p>
        {stack && (
          <details className="error-boundary-details">
            <summary>展开错误堆栈</summary>
            <pre>{stack.trim()}</pre>
          </details>
        )}
        <div className="error-boundary-actions">
          <button className="button secondary" onClick={this.handleRetry}>重试</button>
          <button className="button primary" onClick={this.handleReload}>重新加载应用</button>
        </div>
      </div>
    )
  }
}
