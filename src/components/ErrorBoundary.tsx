import React from "react";
import i18n from "../i18n";
import { isDictationPanelWindow } from "../utils/windowContext";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const compact = isDictationPanelWindow();
      if (compact) {
        return (
          <div className="h-full w-full flex items-center justify-center p-2 bg-background">
            <div className="text-center space-y-1 max-w-full">
              <p className="text-[10px] font-medium text-destructive leading-tight">
                {i18n.t("errorBoundary.title")}
              </p>
              {this.state.error?.message && (
                <p className="text-[9px] text-muted-foreground line-clamp-3 leading-tight">
                  {this.state.error.message}
                </p>
              )}
              <button
                type="button"
                onClick={this.handleReload}
                className="text-[9px] text-primary underline"
              >
                {i18n.t("errorBoundary.reload")}
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-4">
            {/* font-semibold needs `!`: the unlayered `h1,h2,...,h6`
                font-weight:600 rule in index.css still beats a plain utility. */}
            <h1 className="text-lg font-semibold! text-foreground">
              {i18n.t("errorBoundary.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{i18n.t("errorBoundary.description")}</p>
            {this.state.error && (
              <pre
                dir="ltr"
                className="text-xs text-destructive bg-surface-1 rounded-md p-3 overflow-auto max-h-32 text-left"
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {i18n.t("errorBoundary.reload")}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
