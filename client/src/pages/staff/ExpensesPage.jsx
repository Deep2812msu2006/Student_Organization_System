import { useState, useRef } from 'react';
import { useListState } from '../../hooks/useListState.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResource } from '../../hooks/useResource.js';
import { api, uploadReceipt } from '../../services/api.js';
import { money } from '../../utils/format.js';
import ModulePanel from '../../components/ModulePanel.jsx';

// @edit:EXPENSES_UI — receipts are private and fetched through authorized endpoints.
export default function ExpensesPage() {
  const { user } = useAuth();
  const staff = user?.roles.some((r) => ['organizer', 'treasurer'].includes(r));
  const list = useListState();
  const r = useResource('/browse/expenses?' + list.query);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState(null);
  const [showComposer, setShowComposer] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedFileName, setSelectedFileName] = useState('');
  const fileInputRef = useRef(null);
  const keys = useRef({});

  async function submit(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const v = new FormData(f);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const file = v.get('receipt');
      if (!file || file.size === 0) {
        throw new Error('Please attach a valid receipt file.');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Receipt must be 5 MB or smaller.');
      }
      const receipt = await uploadReceipt(file);
      await api('/expenses', {
        method: 'POST',
        body: {
          amountMinor: Math.round(Number(v.get('amount')) * 100),
          currency: v.get('currency'),
          purpose: v.get('purpose'),
          receiptKey: receipt.data.receiptKey,
        },
      });
      f.reset();
      setSelectedFileName('');
      setShowComposer(false);
      setNotice('Expense claim submitted successfully for review.');
      list.search('');
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const v = Object.fromEntries(new FormData(e.currentTarget));
    const path = '/expenses/' + action.id + (action.type === 'reimburse' ? '/reimburse' : '/decision');
    const body =
      action.type === 'reimburse'
        ? { reimbursementReference: v.reason || null }
        : { decision: action.type, reason: v.reason || '' };
    const payload = JSON.stringify(body);
    if (keys.current[path]?.payload !== payload) {
      keys.current[path] = { payload, key: crypto.randomUUID() };
    }
    try {
      await api(path, {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': keys.current[path].key },
      });
      setAction(null);
      setNotice(
        action.type === 'reimburse'
          ? 'Reimbursement recorded successfully.'
          : `Expense claim marked as ${action.type}.`
      );
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const rawExpenses = r.data?.data || [];
  const submittedCount = rawExpenses.filter((x) => x.status === 'submitted').length;
  const approvedCount = rawExpenses.filter((x) => x.status === 'approved').length;
  const reimbursedCount = rawExpenses.filter((x) => x.status === 'reimbursed').length;
  const rejectedCount = rawExpenses.filter((x) => x.status === 'rejected').length;

  const filteredExpenses = rawExpenses.filter((x) => {
    if (activeFilter === 'submitted') return x.status === 'submitted';
    if (activeFilter === 'approved') return x.status === 'approved';
    if (activeFilter === 'reimbursed') return x.status === 'reimbursed';
    if (activeFilter === 'rejected') return x.status === 'rejected';
    return true;
  });

  return (
    <ModulePanel
      title={staff ? 'Expense Claims & Reimbursements' : 'My Expense Claims'}
      description="Submit event and operational expense receipts, track review approvals, and monitor payment disbursements."
      resource={r}
    >
      {/* Dashboard Overview Metrics */}
      <div className="expenses-dashboard-bar">
        <div className="expenses-stats-row">
          <div className="expenses-stat-card">
            <span className="expenses-stat-label">Total Claims</span>
            <span className="expenses-stat-val">{rawExpenses.length}</span>
          </div>
          <div className="expenses-stat-card">
            <span className="expenses-stat-label">⏳ Pending Review</span>
            <span className="expenses-stat-val pending">{submittedCount}</span>
          </div>
          <div className="expenses-stat-card">
            <span className="expenses-stat-label">✓ Approved (Unpaid)</span>
            <span className="expenses-stat-val approved">{approvedCount}</span>
          </div>
          <div className="expenses-stat-card">
            <span className="expenses-stat-label">💳 Reimbursed</span>
            <span className="expenses-stat-val reimbursed">{reimbursedCount}</span>
          </div>
        </div>

        {/* Controls Row: Status Filters & File Claim Button */}
        <div className="expenses-controls-row">
          <div className="expenses-filter-pills" role="tablist" aria-label="Filter expenses">
            <button
              type="button"
              className={`expense-filter-pill ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              All Claims ({rawExpenses.length})
            </button>
            <button
              type="button"
              className={`expense-filter-pill ${activeFilter === 'submitted' ? 'active' : ''}`}
              onClick={() => setActiveFilter('submitted')}
            >
              ⏳ Pending ({submittedCount})
            </button>
            <button
              type="button"
              className={`expense-filter-pill ${activeFilter === 'approved' ? 'active' : ''}`}
              onClick={() => setActiveFilter('approved')}
            >
              ✓ Approved ({approvedCount})
            </button>
            <button
              type="button"
              className={`expense-filter-pill ${activeFilter === 'reimbursed' ? 'active' : ''}`}
              onClick={() => setActiveFilter('reimbursed')}
            >
              💳 Reimbursed ({reimbursedCount})
            </button>
            {rejectedCount > 0 && (
              <button
                type="button"
                className={`expense-filter-pill ${activeFilter === 'rejected' ? 'active' : ''}`}
                onClick={() => setActiveFilter('rejected')}
              >
                ✕ Rejected ({rejectedCount})
              </button>
            )}
          </div>

          <button
            type="button"
            className="expense-create-btn"
            onClick={() => setShowComposer(!showComposer)}
          >
            {showComposer ? '✕ Close Form' : '+ Submit New Claim'}
          </button>
        </div>
      </div>

      <ListSearch list={list} label="Search purpose, requester name or status" />

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

      {/* Modern Submit Expense Composer Drawer */}
      {showComposer && (
        <form className="expense-composer-card module-form" onSubmit={submit}>
          <div className="expense-composer-header">
            <h2 className="expense-composer-title">
              <span>💳</span> File Expense Reimbursement
            </h2>
            <button
              type="button"
              className="button button-secondary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              onClick={() => setShowComposer(false)}
            >
              Close
            </button>
          </div>

          <label>
            Expense Purpose / Description
            <input
              name="purpose"
              required
              minLength="3"
              maxLength="500"
              placeholder="e.g. Stage lighting cables rental for Annual Symposium"
            />
          </label>

          <div className="expense-input-grid">
            <label>
              Amount (major units)
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                max="10000000"
                required
                placeholder="e.g. 350.00"
              />
            </label>

            <label>
              Currency
              <select name="currency" defaultValue="INR">
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </label>
          </div>

          <div>
            <span
              style={{
                display: 'block',
                fontSize: '0.88rem',
                fontWeight: 600,
                color: 'var(--color-text)',
                marginBottom: '0.4rem',
              }}
            >
              Private Receipt Upload (JPEG, PNG, WebP or PDF, up to 5 MB)
            </span>
            <div
              className="expense-receipt-dropzone"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                name="receipt"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setSelectedFileName(f ? `${f.name} (${(f.size / 1024).toFixed(1)} KB)` : '');
                }}
              />
              <div className="expense-dropzone-inner">
                <span className="expense-dropzone-icon">📎</span>
                <span className="expense-dropzone-text">
                  {selectedFileName ? 'Change receipt file' : 'Click to select receipt file'}
                </span>
                <span className="expense-dropzone-sub">
                  Supports secure scanned vouchers, PDFs, or mobile receipt photos
                </span>
                {selectedFileName && (
                  <span className="expense-file-chosen-badge">
                    ✓ Attached: {selectedFileName}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button className="button" disabled={busy}>
              {busy ? 'Uploading & Submitting…' : 'Submit Expense Claim'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setShowComposer(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Decision / Review Modal Backdrop */}
      {action && (
        <div className="expense-modal-backdrop" onClick={() => !busy && setAction(null)}>
          <div className="expense-modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="expense-modal-title">
              {action.type === 'reimburse'
                ? '💳 Record Reimbursement'
                : action.type === 'approved'
                ? '✓ Approve Expense Claim'
                : '✕ Reject Expense Claim'}
            </h2>

            <div className="expense-modal-context">
              <div>
                <strong>Purpose:</strong> {action.item?.purpose}
              </div>
              <div>
                <strong>Amount:</strong>{' '}
                {money(action.item?.amountMinor, action.item?.currency)}
              </div>
              <div>
                <strong>Submitted by:</strong> {action.item?.requesterName}
              </div>
            </div>

            <form className="module-form" onSubmit={decide} style={{ margin: 0 }}>
              <label>
                {action.type === 'reimburse'
                  ? 'Payment Reference / Transaction ID'
                  : action.type === 'approved'
                  ? 'Approval Note / Memo (Optional)'
                  : 'Rejection Reason'}
                <input
                  name="reason"
                  maxLength="200"
                  required={action.type === 'rejected'}
                  placeholder={
                    action.type === 'reimburse'
                      ? 'e.g. Bank UTR # / UPI Ref # / Cheque 4021'
                      : action.type === 'rejected'
                      ? 'e.g. Receipt unreadable or out of policy'
                      : 'e.g. Approved per budget committee'
                  }
                  autoFocus
                />
              </label>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  className="button"
                  style={{
                    background:
                      action.type === 'rejected'
                        ? '#dc2626'
                        : action.type === 'reimburse'
                        ? '#6366f1'
                        : '#10b981',
                  }}
                  disabled={busy}
                >
                  {busy ? 'Processing…' : 'Confirm & Save'}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => setAction(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modern Expenses Grid */}
      <div className="expenses-grid">
        {!r.loading &&
          filteredExpenses.map((x) => (
            <ExpenseCard
              key={x.id}
              expense={x}
              user={user}
              staff={staff}
              onAction={(type) => setAction({ id: x.id, type, item: x })}
            />
          ))}
      </div>

      {!r.loading && filteredExpenses.length === 0 && (
        <EmptyList
          title={list.q ? 'No matching expense claims' : 'No expenses in this filter'}
          message={
            list.q
              ? 'Try another keyword or search query.'
              : 'Submitted expense claims will appear here.'
          }
        />
      )}

      <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="expenses" />
    </ModulePanel>
  );
}

function ExpenseCard({ expense, user, staff, onAction }) {
  const isOwner = expense.requesterId === user?.id;

  const dateStr = expense.createdAt
    ? new Date(expense.createdAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';

  const requesterInitial = (expense.requesterName || 'M').charAt(0).toUpperCase();

  return (
    <article className="expense-card">
      <div className={`expense-card-stripe ${expense.status}`} />

      <div className="expense-card-content">
        {/* Top bar: Status Pill & Date */}
        <div className="expense-card-topbar">
          <span className={`expense-status-tag ${expense.status}`}>
            {expense.status === 'submitted' && '⏳ Pending Review'}
            {expense.status === 'approved' && '✓ Approved'}
            {expense.status === 'reimbursed' && '💳 Reimbursed'}
            {expense.status === 'rejected' && '✕ Rejected'}
          </span>
          {dateStr && <span className="expense-date-tag">📅 {dateStr}</span>}
        </div>

        {/* Purpose Title */}
        <h2 className="expense-purpose">{expense.purpose}</h2>

        {/* Amount Box */}
        <div className="expense-amount-box">
          <span className="expense-amount-val">
            {money(expense.amountMinor, expense.currency)}
          </span>
          <span className="expense-currency-tag">{expense.currency}</span>
        </div>

        {/* Requester Info */}
        <div className="expense-requester-row">
          <div className="expense-requester-avatar">{requesterInitial}</div>
          <div>
            <span style={{ fontSize: '0.72rem', display: 'block', color: 'var(--color-muted)' }}>
              Claimant
            </span>
            <strong style={{ color: 'var(--color-text)' }}>
              {expense.requesterName} {isOwner ? '(You)' : ''}
            </strong>
          </div>
        </div>

        {/* Receipt Link Button */}
        <div>
          <a
            href={`/api/v1/expenses/${expense.id}/receipt`}
            target="_blank"
            rel="noreferrer"
            className="expense-receipt-btn"
          >
            <span>📄</span> View Attached Receipt ↗
          </a>
        </div>
      </div>

      {/* Staff Actions Bar */}
      {staff && (
        <>
          {expense.status === 'submitted' && !isOwner && (
            <div className="expense-actions-bar">
              <button
                type="button"
                className="expense-action-btn approve"
                onClick={() => onAction('approved')}
              >
                ✓ Approve
              </button>
              <button
                type="button"
                className="expense-action-btn reject"
                onClick={() => onAction('rejected')}
              >
                ✕ Reject
              </button>
            </div>
          )}

          {expense.status === 'submitted' && isOwner && (
            <div
              style={{
                padding: '0.65rem 1.4rem',
                fontSize: '0.78rem',
                color: 'var(--color-muted)',
                background: '#f8fafc',
                borderTop: '1px solid var(--color-border)',
                fontStyle: 'italic',
              }}
            >
              Your claim (segregation of duties: reviewed by another staff member)
            </div>
          )}

          {expense.status === 'approved' && (
            <div className="expense-actions-bar">
              <button
                type="button"
                className="expense-action-btn reimburse"
                onClick={() => onAction('reimburse')}
              >
                💳 Record Reimbursement Payout
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
