import { Component } from 'react';

const C = {
  card:"#0c1220", border:"#1a2540", red:"#ef4444", redGlow:"rgba(239,68,68,0.12)",
  text:"#e2e8f0", textDim:"#64748b", blue:"#3b82f6",
};

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`ErrorBoundary [${this.props.label || "unknown"}]:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          background: C.redGlow, border: `1px solid ${C.red}33`,
          borderRadius: 12, padding: "20px 24px", margin: "8px 0",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>
            {this.props.icon || "⚠️"}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.red, marginBottom: 4 }}>
            {this.props.label || "Something went wrong"}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>
            {this.state.error?.message || "An unexpected error occurred"}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: `${C.blue}22`, border: `1px solid ${C.blue}44`,
              borderRadius: 6, padding: "6px 16px", color: C.blue,
              fontSize: 11, fontWeight: 700, cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
