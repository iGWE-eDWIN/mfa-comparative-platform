import { Component } from 'react';

/** Availability NFR: a rendering fault shows a recoverable message instead of a blank page. */
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth-wrap">
        <div className="card auth-card" role="alert">
          <h1>Something went wrong</h1>
          <p>The page failed to render: {this.state.error.message}</p>
          <button className="btn primary" onClick={() => window.location.assign('/')}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }
}
