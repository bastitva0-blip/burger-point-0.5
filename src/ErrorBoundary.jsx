// ─────────────────────────────────────────────────────────
//  ErrorBoundary.jsx — last line of defence.
//  Without this, ANY uncaught error anywhere in the render tree
//  (Admin, Rider, or Customer) unmounts the whole app and leaves a blank
//  white screen with nothing in the UI to explain why. This catches that,
//  shows a simple "something went wrong" screen with a reload button, and
//  logs the real error to the console so it's debuggable from a phone via
//  remote inspection instead of just vanishing.
// ─────────────────────────────────────────────────────────
import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[bp] Uncaught render error — caught by ErrorBoundary:", error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-orange-50 to-amber-50">
        <div className="text-5xl mb-4">🍔💥</div>
        <p className="text-lg font-black text-stone-800">Something went wrong</p>
        <p className="text-sm text-stone-500 mt-2 max-w-xs">
          {this.props.label || "This screen"} hit an unexpected error. Your order/data is safe — just needs a reload.
        </p>
        <button
          onClick={this.handleReload}
          className="mt-6 bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold px-6 py-3 rounded-2xl shadow-md active:scale-95 transition-transform">
          🔄 Reload
        </button>
        {this.props.showDetails && this.state.error && (
          <pre className="mt-4 text-[10px] text-stone-400 max-w-sm overflow-auto text-left bg-white/60 rounded-xl p-3">
            {String(this.state.error?.message || this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}
