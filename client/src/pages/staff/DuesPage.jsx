import { useState, useRef } from 'react';
import { useListState } from '../../hooks/useListState.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import { api } from '../../services/api.js';
import { useResource } from '../../hooks/useResource.js';
import { money } from '../../utils/format.js';
import ModulePanel from '../../components/ModulePanel.jsx';

// @edit:DUES_PAYMENT_UI — modern treasury dues collection desk & waiver management
export default function DuesPage() {
  const list = useListState();
  const r = useResource('/browse/dues?' + list.query);

  const [selected, setSelected] = useState(null);
  const [waiveTarget, setWaiveTarget] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState('cash');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(null);

  async function submitPayment(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const v = Object.fromEntries(new FormData(e.currentTarget));
    const body = {
      duesObligationId: selected.id,
      amountMinor: selected.amountMinor,
      currency: selected.currency,
      method: selected.amountMinor === 0 ? 'zero_price' : selectedMethod,
      externalReference: v.externalReference || null,
      notes: v.notes || '',
    };
    const payload = JSON.stringify(body);
    if (key.current?.payload !== payload) {
      key.current = { payload, value: crypto.randomUUID() };
    }
    try {
      await api('/payments/dues/manual', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': key.current.value },
      });
      setSelected(null);
      key.current = null;
      setNotice(
        `Payment of ${money(selected.amountMinor, selected.currency)} successfully recorded for ${selected.userName}.`
      );
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitWaive(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const v = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api('/dues/' + waiveTarget.id + '/waive', {
        method: 'POST',
        body: { notes: v.notes || 'Hardship / Committee Waiver' },
      });
      setNotice(`Dues obligation for ${waiveTarget.userName} marked as waived.`);
      setWaiveTarget(null);
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const rawDues = r.data?.data || [];
  const totalReceivablesMinor = rawDues.reduce(
    (sum, d) => sum + (Number(d.amountMinor) || 0),
    0
  );
  const currency = rawDues[0]?.currency || 'INR';

  return (
    <ModulePanel
      title="Membership Dues & Receivables Desk"
      description="Record external payments (Cash, UPI, Bank Transfer) or grant approved dues waivers for student members."
      resource={r}
    >
      {/* Top Level Summary Metrics */}
      <div className="dues-dashboard-bar">
        <div className="dues-stats-row">
          <div className="dues-stat-card">
            <span className="dues-stat-label">Pending Invoices</span>
            <span className="dues-stat-val pending">{rawDues.length}</span>
          </div>
          <div className="dues-stat-card">
            <span className="dues-stat-label">Total Outstanding Dues</span>
            <span className="dues-stat-val amount">
              {money(totalReceivablesMinor, currency)}
            </span>
          </div>
          <div className="dues-stat-card">
            <span className="dues-stat-label">Audit Compliance</span>
            <span className="dues-stat-val" style={{ color: '#059669', fontSize: '1.25rem' }}>
              ✓ Verified Ledger
            </span>
          </div>
        </div>
      </div>

      <ListSearch list={list} label="Search student member name, email or plan" />

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

      {/* Dues Cards Grid */}
      <div className="dues-grid">
        {!r.loading &&
          rawDues.map((d) => (
            <DuesCard
              key={d.id}
              dues={d}
              onRecord={() => {
                setSelected(d);
                setSelectedMethod('cash');
                setError('');
                key.current = null;
              }}
              onWaive={() => {
                setWaiveTarget(d);
                setError('');
              }}
            />
          ))}
      </div>

      {!r.loading && rawDues.length === 0 && (
        <EmptyList
          title={list.q ? 'No matching dues obligations' : 'All caught up! No pending dues'}
          message={
            list.q
              ? 'Try another search query or member name.'
              : 'Members with pending dues will appear here for collection.'
          }
        />
      )}

      <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="dues" />

      {/* Payment Record Modal */}
      {selected && (
        <div
          className="mail-modal-backdrop"
          onClick={() => !busy && setSelected(null)}
        >
          <div
            className="mail-modal-envelope"
            style={{ maxWidth: 540 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mail-envelope-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.3rem' }}>💳</span>
                <strong style={{ fontSize: '1.1rem', color: '#0f172a' }}>
                  Record Offline Dues Payment
                </strong>
              </div>
              <button
                type="button"
                className="button button-secondary"
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Context Card */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '0.85rem',
                  padding: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong style={{ display: 'block', fontSize: '1.05rem', color: '#0f172a' }}>
                    {selected.userName}
                  </strong>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    {selected.userEmail} · {selected.planName || 'Annual Membership'}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.72rem', display: 'block', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                    Amount Due
                  </span>
                  <strong style={{ fontSize: '1.35rem', color: '#0f172a' }}>
                    {money(selected.amountMinor, selected.currency)}
                  </strong>
                </div>
              </div>

              <form className="module-form" onSubmit={submitPayment} style={{ margin: 0 }}>
                <div>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: '#475569',
                      marginBottom: '0.35rem',
                      textTransform: 'uppercase',
                    }}
                  >
                    Payment Method
                  </span>
                  <div className="dues-method-grid">
                    <div
                      className={`dues-method-option ${selectedMethod === 'cash' ? 'active' : ''}`}
                      onClick={() => setSelectedMethod('cash')}
                    >
                      <span style={{ fontSize: '1.4rem' }}>💵</span>
                      <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>Cash</strong>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>In-Person</span>
                    </div>

                    <div
                      className={`dues-method-option ${selectedMethod === 'upi' ? 'active' : ''}`}
                      onClick={() => setSelectedMethod('upi')}
                    >
                      <span style={{ fontSize: '1.4rem' }}>📱</span>
                      <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>UPI / QR</strong>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Direct App</span>
                    </div>

                    <div
                      className={`dues-method-option ${selectedMethod === 'bank_transfer' ? 'active' : ''}`}
                      onClick={() => setSelectedMethod('bank_transfer')}
                    >
                      <span style={{ fontSize: '1.4rem' }}>🏦</span>
                      <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>Bank Wire</strong>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>IMPS / NEFT</span>
                    </div>
                  </div>
                </div>

                <label>
                  Receipt / Transfer Reference (Optional)
                  <input
                    name="externalReference"
                    maxLength="200"
                    placeholder="e.g. UPI Ref # / Bank UTR / Receipt Book #204"
                  />
                </label>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button className="button" style={{ flex: 1 }} disabled={busy}>
                    {busy ? 'Processing…' : 'Confirm Payment Received'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => setSelected(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Waive Modal */}
      {waiveTarget && (
        <div
          className="mail-modal-backdrop"
          onClick={() => !busy && setWaiveTarget(null)}
        >
          <div
            className="mail-modal-envelope"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mail-envelope-header">
              <strong style={{ fontSize: '1.1rem', color: '#0f172a' }}>
                🤝 Grant Dues Hardship Waiver
              </strong>
              <button
                type="button"
                className="button button-secondary"
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                disabled={busy}
                onClick={() => setWaiveTarget(null)}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#334155', lineHeight: 1.5 }}>
                Grant an official waiver of{' '}
                <strong>{money(waiveTarget.amountMinor, waiveTarget.currency)}</strong> for{' '}
                <strong>{waiveTarget.userName}</strong>. This activates membership without recording
                incoming revenue.
              </p>

              <form className="module-form" onSubmit={submitWaive} style={{ margin: 0 }}>
                <label>
                  Waiver Reason / Justification
                  <input
                    name="notes"
                    maxLength="200"
                    placeholder="e.g. Student Council Hardship Fund approval"
                    autoFocus
                  />
                </label>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button
                    className="button"
                    style={{ flex: 1, background: '#475569' }}
                    disabled={busy}
                  >
                    {busy ? 'Applying…' : 'Confirm Waiver'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => setWaiveTarget(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </ModulePanel>
  );
}

function DuesCard({ dues, onRecord, onWaive }) {
  const avatarLetter = (dues.userName || 'M').charAt(0).toUpperCase();

  return (
    <article className="dues-card">
      <div className="dues-card-stripe" />

      <div className="dues-card-content">
        <div className="dues-card-topbar">
          <span className="dues-status-tag">⏳ Pending Collection</span>
          <span className="dues-plan-badge">{dues.planName || 'Annual Membership'}</span>
        </div>

        <div className="dues-user-row">
          <div className="dues-avatar">{avatarLetter}</div>
          <div>
            <h2 className="dues-user-name">{dues.userName}</h2>
            <span className="dues-user-email">{dues.userEmail}</span>
          </div>
        </div>

        <div className="dues-amount-box">
          <div>
            <span
              style={{
                fontSize: '0.72rem',
                display: 'block',
                color: 'var(--color-muted)',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              Amount Due
            </span>
            <span className="dues-amount-val">
              {money(dues.amountMinor, dues.currency)}
            </span>
          </div>
          <span style={{ fontSize: '0.76rem', color: '#64748b' }}>External / Offline</span>
        </div>
      </div>

      <div className="dues-actions-bar">
        <button type="button" className="dues-btn-record" onClick={onRecord}>
          💳 Record Payment
        </button>
        <button type="button" className="dues-btn-waive" onClick={onWaive}>
          🤝 Grant Waiver
        </button>
      </div>
    </article>
  );
}
