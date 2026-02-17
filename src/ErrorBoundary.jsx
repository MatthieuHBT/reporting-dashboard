import { Component } from 'react'

export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('App error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
          background: '#0c0f14',
          color: '#e2e8f0',
        }}>
          <h1 style={{ marginBottom: 16, color: '#ef4444' }}>Erreur</h1>
          <pre style={{
            padding: 16,
            background: 'rgba(239,68,68,0.1)',
            borderRadius: 8,
            overflow: 'auto',
            maxWidth: '100%',
            fontSize: 13,
          }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              padding: '10px 20px',
              background: '#f59e0b',
              color: '#0c0f14',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Recharger
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
