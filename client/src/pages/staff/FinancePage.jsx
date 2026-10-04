import { useState, useEffect, useMemo } from 'react';
import { useResource } from '../../hooks/useResource.js';
import { money } from '../../utils/format.js';
import ModulePanel from '../../components/ModulePanel.jsx';

// @edit:FINANCE_CARDS — executive financial reporting with live sync and date range filters
export default function FinancePage() {
  const [preset, setPreset] = useState('all'); // 'all' | 'this_month' | 'last_30' | 'year' | 'custom'
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [autoSync, setAutoSync] = useState(false);
  const [lastSynced, setLastSynced] = useState(new Date());
  const [activeCurrency, setActiveCurrency] = useState('');

  // Calculate ISO dates based on preset
  const queryParams = useMemo(() => {
    const now = new Date();
    if (preset === 'all') return '';
    if (preset === 'this_month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}`;
    }
    if (preset === 'last_30') {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}`;
    }
    if (preset === 'year') {
      const from = new Date(now.getFullYear(), 0, 1).toISOString();
      return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}`;
    }
    if (preset === 'custom' && customFrom) {
      const f = new Date(customFrom).toISOString();
      const t = customTo ? new Date(customTo + 'T23:59:59.999Z').toISOString() : new Date().toISOString();
      return `?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
    }
    return '';
  }, [preset, customFrom, customTo]);

  const r = useResource('/finance/summary' + queryParams);

  // Auto-sync interval
  useEffect(() => {
    if (!autoSync) return;
    const interval = setInterval(() => {
      r.reload();
      setLastSynced(new Date());
    }, 20000);
    return () => clearInterval(interval);
  }, [autoSync, r]);

  function handleManualRefresh() {
    r.reload();
    setLastSynced(new Date());
  }

  const currencies = r.data?.data?.currencies || [];
  const selectedCurrencyCode = activeCurrency || (currencies[0]?.currency ?? 'INR');
  const c = currencies.find((item) => item.currency === selectedCurrencyCode) || currencies[0];

  // Financial values
  const totalReceipts = c?.receipts?.totalMinor || 0;
  const duesMinor = c?.receipts?.duesMinor || 0;
  const eventsMinor = c?.receipts?.eventsMinor || 0;
  const merchMinor = c?.receipts?.merchandiseMinor || 0;

  const reimbursed = c?.disbursements?.reimbursedMinor || 0;
  const netCash = c?.netCashMovementMinor ?? totalReceipts - reimbursed;
  const approvedUnpaid = c?.committedLiabilities?.approvedUnpaidMinor || 0;
  const pendingDues = c?.uncollected?.pendingDuesMinor || 0;
  const waivedDues = c?.uncollected?.waivedDuesMinor || 0;

  // Proportions
  const merchPct = totalReceipts > 0 ? ((merchMinor / totalReceipts) * 100).toFixed(1) : 0;
  const duesPct = totalReceipts > 0 ? ((duesMinor / totalReceipts) * 100).toFixed(1) : 0;
  const eventsPct = totalReceipts > 0 ? ((eventsMinor / totalReceipts) * 100).toFixed(1) : 0;

  return (
    <ModulePanel
      title="Financial Summary & Treasury Ledger"
      description="Recorded receipts, operational disbursements, committed liabilities, and cash movements strictly per currency."
      resource={r}
    >
      {/* Top Header & Live Sync Bar */}
      <div className="finance-dashboard-bar">
        <div className="finance-live-header">
          <div className="finance-live-badge">
            <span className="finance-pulse-dot" />
            <span>Live Treasury Ledger</span>
            <span style={{ color: '#64748b', fontWeight: 500, fontSize: '0.78rem' }}>
              · Synced {lastSynced.toLocaleTimeString()}
            </span>
          </div>

          <div className="finance-live-actions">
            <label className="finance-autosync-toggle">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
              />
              <span>Live Auto-sync (20s)</span>
            </label>

            <button
              type="button"
              className="button button-secondary"
              style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
              onClick={handleManualRefresh}
              disabled={r.loading}
            >
              {r.loading ? 'Syncing…' : '🔄 Refresh Live Data'}
            </button>
          </div>
        </div>

        {/* Live Date Range Presets & Custom Picker */}
        <div className="finance-filters-row">
          <div className="finance-filter-pills" role="tablist" aria-label="Date range filters">
            <button
              type="button"
              className={`finance-pill-btn ${preset === 'all' ? 'active' : ''}`}
              onClick={() => setPreset('all')}
            >
              All Time
            </button>
            <button
              type="button"
              className={`finance-pill-btn ${preset === 'this_month' ? 'active' : ''}`}
              onClick={() => setPreset('this_month')}
            >
              This Month
            </button>
            <button
              type="button"
              className={`finance-pill-btn ${preset === 'last_30' ? 'active' : ''}`}
              onClick={() => setPreset('last_30')}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              className={`finance-pill-btn ${preset === 'year' ? 'active' : ''}`}
              onClick={() => setPreset('year')}
            >
              Year to Date
            </button>
            <button
              type="button"
              className={`finance-pill-btn ${preset === 'custom' ? 'active' : ''}`}
              onClick={() => setPreset('custom')}
            >
              📅 Custom Range
            </button>
          </div>

          {/* Currency Switcher (if multiple) */}
          {currencies.length > 1 && (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>
                Currency:
              </span>
              {currencies.map((curr) => (
                <button
                  key={curr.currency}
                  type="button"
                  className={`finance-pill-btn ${
                    curr.currency === selectedCurrencyCode ? 'active' : ''
                  }`}
                  onClick={() => setActiveCurrency(curr.currency)}
                >
                  {curr.currency}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom Date Input Bar */}
        {preset === 'custom' && (
          <div className="finance-custom-date-box">
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
              From:
            </span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
              To:
            </span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
            <button
              type="button"
              className="button"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              onClick={handleManualRefresh}
            >
              Apply Filter
            </button>
          </div>
        )}
      </div>

      {c ? (
        <>
          {/* Executive Hero KPI Cards Strip */}
          <div className="finance-hero-kpi-row">
            <div className="finance-hero-card highlight">
              <span className="finance-hero-label">
                <span>📈</span> Net Recorded Cash Movement
              </span>
              <span className="finance-hero-val net">
                {netCash >= 0 ? '+' : ''}
                {money(netCash, c.currency)}
              </span>
              <span className="finance-hero-sub">
                Gross Receipts minus Reimbursed Expenses
              </span>
            </div>

            <div className="finance-hero-card">
              <span className="finance-hero-label">
                <span>💰</span> Total Gross Receipts
              </span>
              <span className="finance-hero-val receipts">
                {money(totalReceipts, c.currency)}
              </span>
              <span className="finance-hero-sub">
                Across {c.receipts.totalCount} verified transactions
              </span>
            </div>

            <div className="finance-hero-card">
              <span className="finance-hero-label">
                <span>💳</span> Expenses Reimbursed
              </span>
              <span className="finance-hero-val disbursements">
                {money(reimbursed, c.currency)}
              </span>
              <span className="finance-hero-sub">
                {c.disbursements.reimbursedCount} claims disbursed to volunteers
              </span>
            </div>

            <div className="finance-hero-card">
              <span className="finance-hero-label">
                <span>⏳</span> Committed Liabilities
              </span>
              <span className="finance-hero-val liabilities">
                {money(approvedUnpaid, c.currency)}
              </span>
              <span className="finance-hero-sub">
                {c.committedLiabilities.approvedUnpaidCount} approved claims awaiting payout
              </span>
            </div>
          </div>

          {/* 2-Column Analytics Breakdown */}
          <div className="finance-analytics-grid">
            {/* Left Card: Revenue Streams */}
            <div className="finance-card-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="finance-section-title">
                  <span>📊</span> Inflow by Revenue Stream
                </h3>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#10b981' }}>
                  {money(totalReceipts, c.currency)}
                </span>
              </div>

              {/* Stacked Proportional Color Bar */}
              {totalReceipts > 0 && (
                <div>
                  <div className="finance-multi-bar">
                    <div
                      className="finance-bar-segment merch"
                      style={{ width: `${merchPct}%` }}
                      title={`Merchandise: ${merchPct}%`}
                    />
                    <div
                      className="finance-bar-segment dues"
                      style={{ width: `${duesPct}%` }}
                      title={`Membership Dues: ${duesPct}%`}
                    />
                    <div
                      className="finance-bar-segment events"
                      style={{ width: `${eventsPct}%` }}
                      title={`Event Bookings: ${eventsPct}%`}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '1rem',
                      marginTop: '0.45rem',
                      fontSize: '0.72rem',
                      color: '#64748b',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ width: 8, height: 8, background: '#3b82f6', borderRadius: '50%' }} />
                      Merch ({merchPct}%)
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ width: 8, height: 8, background: '#10b981', borderRadius: '50%' }} />
                      Dues ({duesPct}%)
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ width: 8, height: 8, background: '#8b5cf6', borderRadius: '50%' }} />
                      Events ({eventsPct}%)
                    </span>
                  </div>
                </div>
              )}

              {/* Line Items */}
              <div className="finance-breakdown-list">
                <div className="finance-breakdown-item">
                  <div className="finance-item-left">
                    <span className="finance-item-icon">🛍️</span>
                    <div>
                      <span className="finance-item-label">Merchandise Store</span>
                      <span className="finance-item-sub">
                        {c.receipts.merchandiseCount} club gear orders
                      </span>
                    </div>
                  </div>
                  <div className="finance-item-right">
                    <span className="finance-item-amount">{money(merchMinor, c.currency)}</span>
                    <span className="finance-item-pct">{merchPct}% of gross</span>
                  </div>
                </div>

                <div className="finance-breakdown-item">
                  <div className="finance-item-left">
                    <span className="finance-item-icon">🎓</span>
                    <div>
                      <span className="finance-item-label">Membership Dues</span>
                      <span className="finance-item-sub">
                        {c.receipts.duesCount} annual memberships collected
                      </span>
                    </div>
                  </div>
                  <div className="finance-item-right">
                    <span className="finance-item-amount">{money(duesMinor, c.currency)}</span>
                    <span className="finance-item-pct">{duesPct}% of gross</span>
                  </div>
                </div>

                <div className="finance-breakdown-item">
                  <div className="finance-item-left">
                    <span className="finance-item-icon">🎟️</span>
                    <div>
                      <span className="finance-item-label">Event Registrations</span>
                      <span className="finance-item-sub">
                        {c.receipts.eventsCount} tickets and guest admissions
                      </span>
                    </div>
                  </div>
                  <div className="finance-item-right">
                    <span className="finance-item-amount">{money(eventsMinor, c.currency)}</span>
                    <span className="finance-item-pct">{eventsPct}% of gross</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Card: Disbursements, Liabilities & Receivables */}
            <div className="finance-card-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="finance-section-title">
                  <span>📑</span> Disbursements & Liabilities
                </h3>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#b45309' }}>
                  {money(reimbursed + approvedUnpaid, c.currency)} Total
                </span>
              </div>

              <div className="finance-breakdown-list">
                <div className="finance-breakdown-item">
                  <div className="finance-item-left">
                    <span className="finance-item-icon">💸</span>
                    <div>
                      <span className="finance-item-label">Expenses Reimbursed</span>
                      <span className="finance-item-sub">
                        Disbursed to volunteer claimants
                      </span>
                    </div>
                  </div>
                  <div className="finance-item-right">
                    <span className="finance-item-amount" style={{ color: '#b45309' }}>
                      − {money(reimbursed, c.currency)}
                    </span>
                    <span className="finance-item-pct">
                      {c.disbursements.reimbursedCount} settled vouchers
                    </span>
                  </div>
                </div>

                <div className="finance-breakdown-item">
                  <div className="finance-item-left">
                    <span className="finance-item-icon">⏳</span>
                    <div>
                      <span className="finance-item-label">Approved Awaiting Payout</span>
                      <span className="finance-item-sub">
                        Committed liabilities owed by treasury
                      </span>
                    </div>
                  </div>
                  <div className="finance-item-right">
                    <span className="finance-item-amount" style={{ color: '#dc2626' }}>
                      {money(approvedUnpaid, c.currency)}
                    </span>
                    <span className="finance-item-pct">
                      {c.committedLiabilities.approvedUnpaidCount} pending disbursements
                    </span>
                  </div>
                </div>

                <div className="finance-breakdown-item">
                  <div className="finance-item-left">
                    <span className="finance-item-icon">⚠️</span>
                    <div>
                      <span className="finance-item-label">Unpaid Pending Dues</span>
                      <span className="finance-item-sub">
                        Receivables awaiting student payment
                      </span>
                    </div>
                  </div>
                  <div className="finance-item-right">
                    <span className="finance-item-amount" style={{ color: '#d97706' }}>
                      {money(pendingDues, c.currency)}
                    </span>
                    <span className="finance-item-pct">
                      {c.uncollected.pendingDuesCount} pending invoices
                    </span>
                  </div>
                </div>

                <div className="finance-breakdown-item">
                  <div className="finance-item-left">
                    <span className="finance-item-icon">🤝</span>
                    <div>
                      <span className="finance-item-label">Waived Dues</span>
                      <span className="finance-item-sub">
                        Financial hardship or committee waivers
                      </span>
                    </div>
                  </div>
                  <div className="finance-item-right">
                    <span className="finance-item-amount">{money(waivedDues, c.currency)}</span>
                    <span className="finance-item-pct">
                      {c.uncollected.waivedDuesCount} granted waivers
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          No financial data recorded for this period.
        </p>
      )}

      {/* Quick Operations Shortcuts */}
      <div className="finance-shortcuts-card">
        <h3 className="finance-section-title">
          <span>⚡</span> Treasury Operations Shortcuts
        </h3>
        <div className="finance-shortcuts-grid">
          <a href="/expenses" className="finance-shortcut-link">
            <span>💳</span> Review & Reimburse Expenses ↗
          </a>
          <a href="/staff/dues" className="finance-shortcut-link">
            <span>🎓</span> Manage Student Dues ↗
          </a>
          <a href="/staff/payments" className="finance-shortcut-link">
            <span>💵</span> Manual Payment Evidence ↗
          </a>
          <a href="/staff/inventory" className="finance-shortcut-link">
            <span>📦</span> Merch Sales & Fulfillment ↗
          </a>
        </div>
      </div>

      {/* Audit Footnote */}
      <div className="finance-audit-notice">
        <strong>🔒 Audited Treasury Ledger Notice:</strong>{' '}
        {r.data?.data?.notice ||
          'Ledger balances reflect verified payment record evidence and approved reimbursement disbursements only. Opening balances and unrecorded external bank fees are not tracked in this ledger.'}
      </div>
    </ModulePanel>
  );
}
