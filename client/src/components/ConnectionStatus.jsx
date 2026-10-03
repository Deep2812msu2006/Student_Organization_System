import { useHealth } from '../hooks/useHealth.js';

export default function ConnectionStatus() {
  const health = useHealth();
  const loading = health.phase === 'loading';
  const connected = health.phase === 'success';
  return <aside className="status-card" aria-labelledby="connection-title">
    <div className="status-header"><span className="eyebrow">CONNECTION CHECK</span><span className="badge">Live API request</span></div>
    <h2 id="connection-title">Start with a solid connection.</h2>
    <p className="muted">React → Express → PostgreSQL</p>
    <div className={`status-message ${connected ? 'success' : loading ? '' : 'warning'}`} role="status" aria-live="polite" aria-atomic="true">
      <strong>{loading ? 'Checking connection…' : connected ? 'Database connected' : 'Connection needs attention'}</strong>
      <p>{loading ? 'Requesting the current API and database status.' : connected ? 'The API completed a real PostgreSQL query. Your membership profile is backed by persistent data.' : health.message}</p>
    </div>
    <button type="button" className="button button-secondary" disabled={loading} onClick={health.check}>{loading ? 'Checking…' : 'Check again'}</button>
    <p className="status-meta">{connected ? `Last checked: ${new Date(health.data.checkedAt).toLocaleTimeString()}` : 'Configure your local connection in server/.env.'}</p>
  </aside>;
}
