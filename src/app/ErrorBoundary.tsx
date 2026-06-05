import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

// Catches render-time crashes anywhere below it and shows the error/stack on
// screen instead of a blank page. Useful for diagnosing the admin editor.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('App crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#fff', background: '#0e0e0e', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h1 style={{ color: '#ff4655', fontSize: 18, marginBottom: 12 }}>Something crashed</h1>
          <p style={{ marginBottom: 12 }}>{this.state.error.message}</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#aaa', maxHeight: '60vh', overflow: 'auto' }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 16px', background: '#ff4655', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
