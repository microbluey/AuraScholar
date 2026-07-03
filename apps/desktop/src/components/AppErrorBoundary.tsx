import { Component, type ErrorInfo, type ReactNode } from "react";
import { writeClipboardText } from "../clipboard";

interface AppErrorBoundaryProps {
  children: ReactNode;
  level?: "root" | "route";
  resetKey?: string;
  scope?: string;
}

interface AppErrorBoundaryState {
  copied: boolean;
  copyFailed: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  occurredAt: string | null;
}

const INITIAL_STATE: AppErrorBoundaryState = {
  copied: false,
  copyFailed: false,
  error: null,
  errorInfo: null,
  occurredAt: null,
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state = INITIAL_STATE;

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      copied: false,
      copyFailed: false,
      error,
      errorInfo: null,
      occurredAt: new Date().toISOString(),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[AuraScholar] render boundary captured an error", error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidUpdate(previousProps: AppErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  private diagnosticText() {
    const { error, errorInfo, occurredAt } = this.state;
    return [
      `AuraScholar crash report`,
      `Scope: ${this.props.scope ?? "App"}`,
      `Level: ${this.props.level ?? "route"}`,
      `Time: ${occurredAt ?? new Date().toISOString()}`,
      `URL: ${window.location.href}`,
      `Message: ${error?.message ?? "Unknown error"}`,
      error?.stack ? `Stack:\n${error.stack}` : null,
      errorInfo?.componentStack ? `Component stack:\n${errorInfo.componentStack}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private reset = () => {
    this.setState(INITIAL_STATE);
  };

  private goLibrary = () => {
    window.location.hash = "#/library";
    this.reset();
  };

  private reload = () => {
    window.location.reload();
  };

  private copyDiagnostic = async () => {
    try {
      await writeClipboardText(this.diagnosticText());
      this.setState({ copied: true, copyFailed: false });
    } catch {
      this.setState({ copied: false, copyFailed: true });
    }
  };

  render() {
    const { children, level = "route", scope } = this.props;
    const { copied, copyFailed, error, errorInfo, occurredAt } = this.state;
    if (!error) return children;

    const isRoot = level === "root";
    const title = isRoot ? "AuraScholar 启动时遇到问题" : `${scope ?? "当前页面"} 暂时不可用`;
    const message = isRoot
      ? "应用没有进入可用状态。你可以重载应用，或复制诊断信息给开发者定位。"
      : "页面组件发生了渲染异常，外层工作台仍然可用。切换到其他工作区或返回文献库即可继续。";

    return (
      <section
        className={`app-error-boundary ${isRoot ? "app-error-boundary--root" : "app-error-boundary--route"}`}
        role="alert"
        aria-live="assertive"
      >
        <div className="app-error-boundary__panel">
          <div className="app-error-boundary__mark" aria-hidden="true">
            !
          </div>
          <p className="app-error-boundary__eyebrow">{isRoot ? "启动保护" : "页面保护"}</p>
          <h1>{title}</h1>
          <p>{message}</p>
          <div className="app-error-boundary__actions">
            {!isRoot && (
              <button type="button" onClick={this.goLibrary}>
                回到文献库
              </button>
            )}
            <button type="button" onClick={this.reset}>
              再试一次
            </button>
            <button type="button" onClick={this.reload}>
              重载应用
            </button>
            <button type="button" onClick={() => void this.copyDiagnostic()}>
              {copied ? "已复制诊断" : copyFailed ? "复制失败" : "复制诊断"}
            </button>
          </div>
          <details className="app-error-boundary__detail">
            <summary>错误详情</summary>
            <dl>
              <div>
                <dt>时间</dt>
                <dd>{occurredAt ?? "未知"}</dd>
              </div>
              <div>
                <dt>信息</dt>
                <dd>{error.message}</dd>
              </div>
            </dl>
            {errorInfo?.componentStack && <pre>{errorInfo.componentStack}</pre>}
          </details>
        </div>
      </section>
    );
  }
}
