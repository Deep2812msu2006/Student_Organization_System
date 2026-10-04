import { useState } from 'react';
import { useListState } from '../../hooks/useListState.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import { useResource } from '../../hooks/useResource.js';
import { api } from '../../services/api.js';
import ModulePanel from '../../components/ModulePanel.jsx';

// @edit:MAIL_PREFERENCES — modern notification dispatcher, local email previews & subscriber controls
export default function MailPage({ staff = false }) {
  const list = useListState();
  const r = useResource(staff ? '/browse/mail?' + list.query : '/mail/preferences');

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'previewed' | 'queued'
  const [selectedMail, setSelectedMail] = useState(null);

  async function act(path, body, method = 'POST', successMsg) {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await api(path, { method, body });
      setNotice(
        successMsg || 'Saved. Mail uses local preview sandbox; no external email was sent.'
      );
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const rawMessages = r.data?.data || [];
  const previewedCount = Array.isArray(rawMessages)
    ? rawMessages.filter((m) => m.status === 'previewed').length
    : 0;
  const queuedCount = Array.isArray(rawMessages)
    ? rawMessages.filter((m) => m.status === 'queued').length
    : 0;

  const filteredMessages = Array.isArray(rawMessages)
    ? rawMessages.filter((m) => {
        if (activeFilter === 'previewed') return m.status === 'previewed';
        if (activeFilter === 'queued') return m.status === 'queued';
        return true;
      })
    : [];

  return (
    <ModulePanel
      title={staff ? 'Mail & Notification Dispatcher' : 'My Mail & Communication Preferences'}
      description={
        staff
          ? 'Monitor automated membership renewals, announcements, and local notification previews.'
          : 'Manage your opt-in subscriptions for campus announcements and event notices.'
      }
      resource={r}
    >
      {/* Staff View */}
      {staff ? (
        <>
          {/* Dispatcher Dashboard KPI Strip */}
          <div className="mail-dashboard-bar">
            <div className="mail-stats-row">
              <div className="mail-stat-card">
                <span className="mail-stat-label">Total Outbox Messages</span>
                <span className="mail-stat-val">{rawMessages.length}</span>
              </div>
              <div className="mail-stat-card">
                <span className="mail-stat-label">Processed Previews</span>
                <span className="mail-stat-val previewed">{previewedCount}</span>
              </div>
              <div className="mail-stat-card">
                <span className="mail-stat-label">Queued For Delivery</span>
                <span className="mail-stat-val queued">{queuedCount}</span>
              </div>
              <div className="mail-stat-card">
                <span className="mail-stat-label">Delivery Sandbox</span>
                <span className="mail-stat-val safe">100% Safe</span>
              </div>
            </div>

            {/* Actions Toolbar & Fast Filters */}
            <div className="mail-actions-toolbar">
              <div className="mail-action-buttons">
                <button
                  type="button"
                  className="mail-btn-primary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      '/staff/reminders/run',
                      { days: 14 },
                      'POST',
                      'Renewal reminders queued for memberships expiring within 14 days.'
                    )
                  }
                >
                  <span>⏰</span> Queue 14-Day Renewal Reminders
                </button>

                <button
                  type="button"
                  className="mail-btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      '/staff/mail/preview',
                      {},
                      'POST',
                      'Processed queued outbox items to local preview status.'
                    )
                  }
                >
                  <span>📨</span> Process Local Previews
                </button>
              </div>

              {/* Status Filter Pills */}
              <div className="finance-filter-pills" role="tablist" aria-label="Filter outbox">
                <button
                  type="button"
                  className={`finance-pill-btn ${activeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('all')}
                >
                  All ({rawMessages.length})
                </button>
                <button
                  type="button"
                  className={`finance-pill-btn ${activeFilter === 'previewed' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('previewed')}
                >
                  👁️ Previewed ({previewedCount})
                </button>
                <button
                  type="button"
                  className={`finance-pill-btn ${activeFilter === 'queued' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('queued')}
                >
                  ⏳ Queued ({queuedCount})
                </button>
              </div>
            </div>
          </div>

          <ListSearch list={list} label="Search recipient email, subject or status" />

          {error && (
            <p role="alert" className="form-error" style={{ marginBlock: 'var(--space-3)' }}>
              {error}
            </p>
          )}
          {notice && (
            <p className="notice" role="status" style={{ marginBlock: 'var(--space-3)' }}>
              {notice}
            </p>
          )}

          {/* Outbox Cards Grid */}
          <div className="mail-grid">
            {!r.loading &&
              filteredMessages.map((m) => (
                <MailCard
                  key={m.id}
                  mail={m}
                  onInspect={() => setSelectedMail(m)}
                />
              ))}
          </div>

          {!r.loading && filteredMessages.length === 0 && (
            <EmptyList
              title={list.q ? 'No matching emails found' : 'No messages in this filter'}
              message={
                list.q
                  ? 'Try another keyword or recipient email.'
                  : 'Queued or previewed mail will appear here.'
              }
            />
          )}

          <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Mail" />

          {/* Email Inspector Modal */}
          {selectedMail && (
            <div className="mail-modal-backdrop" onClick={() => setSelectedMail(null)}>
              <div
                className="mail-modal-envelope"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mail-envelope-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>✉️</span>
                    <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
                      Notification Preview
                    </strong>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                    onClick={() => setSelectedMail(null)}
                  >
                    ✕ Close
                  </button>
                </div>

                <div className="mail-envelope-meta">
                  <div className="mail-meta-row">
                    <span className="mail-meta-label">From:</span>
                    <span>Skyline Campus Notifications &lt;system@skyline.org&gt;</span>
                  </div>
                  <div className="mail-meta-row">
                    <span className="mail-meta-label">To:</span>
                    <strong>{selectedMail.email}</strong>
                  </div>
                  <div className="mail-meta-row">
                    <span className="mail-meta-label">Subject:</span>
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>
                      {selectedMail.subject}
                    </span>
                  </div>
                  <div className="mail-meta-row">
                    <span className="mail-meta-label">Status:</span>
                    <span className={`mail-status-tag ${selectedMail.status}`}>
                      {selectedMail.status}
                    </span>
                  </div>
                </div>

                <div className="mail-envelope-body">{selectedMail.body}</div>

                <div className="mail-envelope-footer">
                  <span>🔒 Local Preview Sandbox Mode</span>
                  <span>ID: {selectedMail.id ? selectedMail.id.slice(0, 8) : ''}</span>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Regular Member View */
        <div style={{ display: 'flex', justifyContent: 'center', marginBlock: '2rem' }}>
          <div className="mail-preferences-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.5rem' }}>📬</span>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                  Notification Subscriptions
                </h2>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.84rem', color: '#64748b' }}>
                  Manage notifications for club announcements and upcoming renewal reminders.
                </p>
              </div>
            </div>

            {notice && <p className="notice" role="status">{notice}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}

            <div className="mail-preference-toggle-row">
              <div>
                <strong style={{ display: 'block', fontSize: '0.95rem', color: '#0f172a' }}>
                  Announcements & Renewals
                </strong>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  Status: <strong>{r.data?.data?.subscribed ? 'Subscribed' : 'Not Subscribed'}</strong>
                </span>
              </div>

              <button
                type="button"
                className={`button ${r.data?.data?.subscribed ? 'button-secondary' : ''}`}
                disabled={busy || r.loading}
                onClick={() =>
                  act(
                    '/mail/preferences',
                    { subscribed: !r.data?.data?.subscribed },
                    'PUT',
                    r.data?.data?.subscribed
                      ? 'You have unsubscribed from mail notifications.'
                      : 'You are now subscribed to club announcements and reminders.'
                  )
                }
              >
                {busy
                  ? 'Updating…'
                  : r.data?.data?.subscribed
                  ? 'Unsubscribe'
                  : 'Subscribe Now'}
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5, margin: 0 }}>
              💡 You can change your preference at any time. When you unsubscribe, any queued renewal
              reminders or blast announcements are automatically suppressed.
            </p>
          </div>
        </div>
      )}
    </ModulePanel>
  );
}

function MailCard({ mail, onInspect }) {
  const avatarLetter = (mail.email || 'M').charAt(0).toUpperCase();

  const formattedDate = mail.createdAt
    ? new Date(mail.createdAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <article className="mail-card">
      <div className={`mail-card-stripe ${mail.status}`} />

      <div className="mail-card-content">
        <div className="mail-card-top">
          <span className={`mail-status-tag ${mail.status}`}>
            {mail.status === 'previewed' && '👁️ Previewed'}
            {mail.status === 'queued' && '⏳ Queued'}
            {mail.status === 'sent' && '✓ Sent'}
          </span>
          {formattedDate && (
            <span style={{ fontSize: '0.74rem', color: '#64748b' }}>📅 {formattedDate}</span>
          )}
        </div>

        <h2 className="mail-subject">
          <span>✉️</span> {mail.subject}
        </h2>

        <div className="mail-recipient-box">
          <div className="mail-recipient-avatar">{avatarLetter}</div>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {mail.email}
          </span>
        </div>

        <p className="mail-body-preview">{mail.body}</p>
      </div>

      <div className="mail-card-footer">
        <button type="button" className="mail-preview-btn" onClick={onInspect}>
          Inspect Full Message ↗
        </button>
      </div>
    </article>
  );
}
