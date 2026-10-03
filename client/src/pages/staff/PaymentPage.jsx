import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { money, date } from '../../utils/format.js';

/**
 * @edit:PAYMENT_UI @edit:MERCHANDISE_PAYMENT_UI — Staff manual payment recording screen.
 *
 * This screen is clearly labeled as "Manual Payment Recording" —
 * not an online payment flow. It does not simulate a payment gateway
 * or collect card details.
 *
 * Supports both:
 * 1. Merchandise Orders: Pending orders awaiting manual settlement.
 * 2. Event Registrations: Pending tickets awaiting cash/transfer recording.
 *
 * Staff permissions: Both 'treasurer' and 'organizer' roles can record manual payments.
 * Ordinary members and volunteers are denied access.
 */
export default function PaymentPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('merchandise'); // 'merchandise' | 'events'

  // Merchandise state
  const [merchOrders, setMerchOrders] = useState(null);
  const [merchLoading, setMerchLoading] = useState(false);
  const [merchError, setMerchError] = useState('');
  const [merchPage, setMerchPage] = useState(1);
  const [merchTotal, setMerchTotal] = useState(0);

  // Events state
  const [eventId, setEventId] = useState('');
  const [events, setEvents] = useState(null);
  const [pendingRegistrations, setPendingRegistrations] = useState(null);
  const [eventError, setEventError] = useState('');

  // Confirmation dialog state
  // confirmType: 'merchandise' | 'event'
  const [confirmType, setConfirmType] = useState('merchandise');
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmKey, setConfirmKey] = useState('');
  const [confirmForm, setConfirmForm] = useState({
    method: 'cash',
    externalReference: '',
    notes: '',
  });
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [confirmError, setConfirmError] = useState('');
  const [confirmConflict, setConfirmConflict] = useState(null);

  // Helper to generate a 16-100 char idempotency key
  function generateIdempotencyKey(prefix = 'pay') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 12);
    return `${prefix}_${timestamp}_${random}`.padEnd(20, '0');
  }

  // Load pending merchandise orders
  const loadPendingOrders = useCallback(async (page = 1) => {
    setMerchLoading(true);
    setMerchError('');
    try {
      const res = await api(`/orders/pending?page=${page}&pageSize=20`);
      setMerchOrders(res.data || []);
      setMerchTotal(res.pagination?.total ?? (res.data?.length || 0));
      setMerchPage(page);
    } catch (err) {
      setMerchError(err.message || 'Failed to load pending merchandise orders.');
    } finally {
      setMerchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'merchandise') {
      loadPendingOrders(merchPage);
    }
  }, [activeTab, loadPendingOrders, merchPage]);

  // Load organizer events
  useEffect(() => {
    if (activeTab === 'events' && !events) {
      const controller = new AbortController();
      api('/organizer/events?pageSize=50', { signal: controller.signal })
        .then(r => setEvents(r.data))
        .catch(e => { if (e.name !== 'AbortError') setEventError(e.message); });
      return () => controller.abort();
    }
  }, [activeTab, events]);

  // Load pending registrations when event changes
  useEffect(() => {
    if (!eventId) { setPendingRegistrations(null); return; }
    const controller = new AbortController();
    setEventError('');
    api(`/events/${eventId}/pending-registrations`, { signal: controller.signal })
      .then(r => setPendingRegistrations(r.data))
      .catch(e => { if (e.name !== 'AbortError') setEventError(e.message); });
    return () => controller.abort();
  }, [eventId]);

  // Keyboard accessibility: Escape closes modal
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && confirmTarget && !confirmBusy) {
        closeConfirmDialog();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmTarget, confirmBusy]);

  function openMerchConfirm(order) {
    setConfirmType('merchandise');
    setConfirmTarget(order);
    // Key generated ONCE when opening dialog, preserved across retries
    setConfirmKey(generateIdempotencyKey('ordpay'));
    setConfirmForm({
      method: order.totalMinor === 0 ? 'zero_price' : 'cash',
      externalReference: '',
      notes: '',
    });
    setConfirmError('');
    setConfirmConflict(null);
    setConfirmResult(null);
  }

  function openEventConfirm(reg) {
    setConfirmType('event');
    setConfirmTarget(reg);
    // Key generated ONCE when opening dialog, preserved across retries
    setConfirmKey(generateIdempotencyKey('evpay'));
    setConfirmForm({
      method: reg.priceMinor === 0 ? 'zero_price' : 'cash',
      externalReference: '',
      notes: '',
    });
    setConfirmError('');
    setConfirmConflict(null);
    setConfirmResult(null);
  }

  function closeConfirmDialog() {
    if (confirmBusy) return;
    setConfirmTarget(null);
    setConfirmResult(null);
    setConfirmError('');
    setConfirmConflict(null);
  }

  async function handleConfirmPayment(e) {
    e.preventDefault();
    if (!confirmTarget || !confirmKey) return;
    setConfirmBusy(true);
    setConfirmError('');
    setConfirmConflict(null);

    const isMerch = confirmType === 'merchandise';
    const endpoint = isMerch ? '/payments/merchandise/manual' : '/payments/manual';
    const amountMinor = isMerch ? confirmTarget.totalMinor : confirmTarget.priceMinor;
    const currency = confirmTarget.currency;

    const body = isMerch
      ? {
          orderId: confirmTarget.id,
          amountMinor,
          currency,
          method: confirmForm.method,
          ...(confirmForm.externalReference?.trim() ? { externalReference: confirmForm.externalReference.trim() } : {}),
          ...(confirmForm.notes?.trim() ? { notes: confirmForm.notes.trim() } : {}),
        }
      : {
          registrationId: confirmTarget.id,
          amountMinor,
          currency,
          method: confirmForm.method,
          ...(confirmForm.externalReference?.trim() ? { externalReference: confirmForm.externalReference.trim() } : {}),
          ...(confirmForm.notes?.trim() ? { notes: confirmForm.notes.trim() } : {}),
        };

    try {
      const res = await api(endpoint, {
        method: 'POST',
        body,
        headers: {
          'Idempotency-Key': confirmKey, // Preserved across retries!
        },
      });

      setConfirmResult({
        success: true,
        replayed: res.replayed,
        data: res.data,
      });

      // Refresh corresponding list immediately after payment confirmation
      if (isMerch) {
        loadPendingOrders(merchPage);
      } else if (eventId) {
        api(`/events/${eventId}/pending-registrations`)
          .then(r => setPendingRegistrations(r.data))
          .catch(() => {});
      }
    } catch (err) {
      if (err.status === 409) {
        setConfirmConflict({
          code: err.code || 'CONFLICT',
          message: err.message || 'Payment or order conflict detected.',
        });
      } else {
        setConfirmError(err.message || 'Failed to record payment.');
      }
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <section className="container account-page" aria-label="Staff payment screen">
      <p className="eyebrow">STAFF & TREASURER OPERATIONS</p>
      <h1>Record manual payment received</h1>
      <p className="muted" style={{ maxWidth: '720px' }}>
        Record payments received outside the online platform (cash, bank transfer, UPI, or cheque).
        This screen does not process cards or gateway payments; it captures audit evidence and updates
        pending reservations and merchandise orders to <strong>PAID</strong>.
      </p>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', marginBottom: '1.5rem' }}>
        <button
          type="button"
          id="tab-merchandise"
          className={activeTab === 'merchandise' ? 'button' : 'button button-secondary'}
          onClick={() => { setActiveTab('merchandise'); closeConfirmDialog(); }}
          aria-pressed={activeTab === 'merchandise'}
        >
          🛍️ Merchandise Orders {merchTotal > 0 ? `(${merchTotal})` : ''}
        </button>
        <button
          type="button"
          id="tab-events"
          className={activeTab === 'events' ? 'button' : 'button button-secondary'}
          onClick={() => { setActiveTab('events'); closeConfirmDialog(); }}
          aria-pressed={activeTab === 'events'}
        >
          🎟️ Event Registrations
        </button>
      </div>

      {/* ─── TAB 1: Merchandise Orders ────────────────────────────────────────── */}
      {activeTab === 'merchandise' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Pending Merchandise Orders</h2>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => loadPendingOrders(merchPage)}
              disabled={merchLoading}
              style={{ fontSize: '0.85rem' }}
            >
              {merchLoading ? 'Refreshing…' : '🔄 Refresh List'}
            </button>
          </div>

          {merchError && <p className="form-error" role="alert">{merchError}</p>}

          {merchLoading && !merchOrders && (
            <p className="muted" role="status">Loading pending orders…</p>
          )}

          {!merchLoading && merchOrders && merchOrders.length === 0 && (
            <div className="status-message success">
              <strong>All caught up!</strong>
              <p>There are no pending merchandise orders requiring payment confirmation.</p>
            </div>
          )}

          {merchOrders && merchOrders.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {merchOrders.map(order => (
                <article
                  key={order.id}
                  className="form-card"
                  style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1.25rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <span className="status-pill">Pending</span>
                      <h3 style={{ margin: '0.35rem 0 0.2rem', fontSize: '1.15rem' }}>
                        Customer: {order.userName}
                      </h3>
                      <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                        {order.userEmail} · Placed on {date(order.createdAt)}
                      </p>
                      <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                        Order ID: {order.id}
                      </p>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>Total Due:</div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-brand)' }}>
                        {money(order.totalMinor, order.currency)}
                      </div>
                      {order.totalMinor === 0 && (
                        <span className="badge" style={{ marginTop: '0.25rem', display: 'inline-block' }}>Zero Price</span>
                      )}
                    </div>
                  </div>

                  {/* Items snapshot breakdown */}
                  <div style={{ marginTop: '1rem', background: 'var(--color-bg)', padding: '0.75rem', borderRadius: '6px' }}>
                    <strong style={{ fontSize: '0.85rem' }}>Reserved Items ({order.items?.length || 0}):</strong>
                    <table className="cart-table" style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Variant</th>
                          <th>Unit Price</th>
                          <th>Qty</th>
                          <th>Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(order.items || []).map(it => (
                          <tr key={it.id || `${it.productName}-${it.variantName}`}>
                            <td style={{ fontWeight: 600 }}>{it.productName}</td>
                            <td>{it.variantName}</td>
                            <td>{money(it.unitPriceMinor, order.currency)}</td>
                            <td>{it.quantity}</td>
                            <td style={{ fontWeight: 600 }}>{money(it.totalMinor, order.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="button"
                      onClick={() => openMerchConfirm(order)}
                    >
                      {order.totalMinor === 0 ? 'Confirm (Free Order)' : 'Record manual payment received'}
                    </button>
                  </div>
                </article>
              ))}

              {/* Pagination controls if more than 20 orders */}
              {merchTotal > 20 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={merchPage <= 1 || merchLoading}
                    onClick={() => loadPendingOrders(merchPage - 1)}
                  >
                    Previous
                  </button>
                  <span style={{ alignSelf: 'center', fontSize: '0.9rem' }}>
                    Page {merchPage} of {Math.ceil(merchTotal / 20)}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={merchPage * 20 >= merchTotal || merchLoading}
                    onClick={() => loadPendingOrders(merchPage + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 2: Event Registrations ───────────────────────────────────────── */}
      {activeTab === 'events' && (
        <div>
          <div className="form-card" style={{ marginBottom: '1.5rem' }}>
            <div className="field">
              <label htmlFor="payment-event">Select Event</label>
              <select
                id="payment-event"
                value={eventId}
                onChange={e => { setEventId(e.target.value); closeConfirmDialog(); }}
                required
              >
                <option value="">Select an event…</option>
                {events?.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} ({ev.status})
                  </option>
                ))}
              </select>
            </div>

            {eventError && <p className="form-error" role="alert">{eventError}</p>}
            {eventId && !pendingRegistrations && !eventError && <p role="status">Loading pending registrations…</p>}

            {pendingRegistrations?.length === 0 && (
              <div className="status-message success">
                <strong>All caught up!</strong>
                <p>No pending registrations for this event. All attendees have been confirmed or cancelled.</p>
              </div>
            )}
          </div>

          {/* Pending registrations list */}
          {pendingRegistrations?.length > 0 && (
            <div className="pending-list">
              <h2>Pending Registrations ({pendingRegistrations.length})</h2>
              <div className="event-grid tickets-grid">
                {pendingRegistrations.map(reg => (
                  <article className="form-card ticket-card" key={reg.id}>
                    <span className="status-pill">Pending</span>
                    <h3>{reg.userName}</h3>
                    <p className="muted">{reg.userEmail}</p>
                    <p>
                      Amount due: <strong>{money(reg.priceMinor, reg.currency)}</strong>
                      {reg.priceMinor === 0 && <span className="badge" style={{ marginLeft: '0.5rem' }}>Free</span>}
                    </p>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>
                      Reserved: {date(reg.createdAt)}
                    </p>
                    <p className="reference" style={{ fontSize: '0.75rem' }}>
                      Ref: {reg.id.slice(0, 8)}…
                    </p>
                    <button
                      type="button"
                      className="button"
                      onClick={() => openEventConfirm(reg)}
                    >
                      {reg.priceMinor === 0 ? 'Confirm (Free Entry)' : 'Record manual payment received'}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Payment Confirmation Modal (Accessible Dialog) ───────────────────── */}
      {confirmTarget && (
        <div
          className="payment-dialog-overlay"
          role="presentation"
          onClick={e => { if (e.target === e.currentTarget) closeConfirmDialog(); }}
        >
          <div
            className="payment-dialog form-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-dialog-title"
          >
            <h2 id="payment-dialog-title">Record manual payment received</h2>

            <div style={{ background: 'var(--color-bg)', padding: '0.85rem', borderRadius: '6px', marginBottom: '1.25rem' }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {confirmType === 'merchandise' ? `Order #${confirmTarget.id.slice(0, 8)}` : `Registration Ref #${confirmTarget.id.slice(0, 8)}`}
              </p>
              <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
                Customer: <strong>{confirmTarget.userName}</strong> ({confirmTarget.userEmail})
              </p>
              <p style={{ margin: '0.5rem 0 0', fontSize: '1.1rem' }}>
                Amount due: <strong style={{ color: 'var(--color-brand)' }}>
                  {money(
                    confirmType === 'merchandise' ? confirmTarget.totalMinor : confirmTarget.priceMinor,
                    confirmTarget.currency
                  )}
                </strong>
              </p>
            </div>

            {/* Success state banner */}
            {confirmResult?.success ? (
              <div className="checkin-result checkin-success" role="alert">
                <div className="checkin-result-icon">✓</div>
                <strong>{confirmResult.replayed ? 'Already confirmed (idempotent replay)' : 'Payment recorded successfully'}</strong>
                <p>
                  {confirmType === 'merchandise'
                    ? 'The merchandise order status has been updated to PAID.'
                    : 'The attendee registration is now confirmed.'}
                </p>
                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="button" onClick={closeConfirmDialog}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConfirmPayment}>
                {/* Method selector */}
                {(confirmType === 'merchandise' ? confirmTarget.totalMinor : confirmTarget.priceMinor) > 0 ? (
                  <>
                    <div className="field">
                      <label htmlFor="payment-method">Payment Method</label>
                      <select
                        id="payment-method"
                        value={confirmForm.method}
                        onChange={e => setConfirmForm({ ...confirmForm, method: e.target.value })}
                        required
                      >
                        <option value="cash">Cash</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="upi">UPI</option>
                        <option value="cheque">Cheque</option>
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="payment-ref">External Reference (optional)</label>
                      <input
                        id="payment-ref"
                        type="text"
                        value={confirmForm.externalReference}
                        onChange={e => setConfirmForm({ ...confirmForm, externalReference: e.target.value })}
                        placeholder="Receipt number, UPI txn ID, or bank reference…"
                        maxLength={200}
                      />
                    </div>
                  </>
                ) : (
                  <div className="field">
                    <label htmlFor="payment-method">Payment Method</label>
                    <input
                      id="payment-method"
                      type="text"
                      value="Zero Price / Complimentary"
                      disabled
                      readOnly
                    />
                  </div>
                )}

                <div className="field">
                  <label htmlFor="payment-notes">Notes (optional)</label>
                  <textarea
                    id="payment-notes"
                    value={confirmForm.notes}
                    onChange={e => setConfirmForm({ ...confirmForm, notes: e.target.value })}
                    placeholder="Staff notes (e.g. collected at booth by treasurer)…"
                    rows={2}
                    maxLength={500}
                  />
                </div>

                {/* Validation and Conflict States */}
                {confirmError && (
                  <div className="status-message error" role="alert" style={{ marginBottom: '1rem' }}>
                    <strong>Confirmation Error:</strong>
                    <p style={{ margin: 0 }}>{confirmError}</p>
                  </div>
                )}

                {confirmConflict && (
                  <div className="status-message error" role="alert" style={{ marginBottom: '1rem' }}>
                    <strong>Conflict Detected ({confirmConflict.code}):</strong>
                    <p style={{ margin: 0 }}>{confirmConflict.message}</p>
                    <button
                      type="button"
                      className="button button-secondary"
                      style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
                      onClick={() => {
                        closeConfirmDialog();
                        if (confirmType === 'merchandise') loadPendingOrders(merchPage);
                      }}
                    >
                      Refresh list to view latest state
                    </button>
                  </div>
                )}

                <div className="payment-dialog-actions">
                  <button
                    className="button"
                    type="submit"
                    id="submit-payment-confirmation"
                    disabled={confirmBusy}
                  >
                    {confirmBusy
                      ? 'Recording manual payment…'
                      : (confirmType === 'merchandise' ? confirmTarget.totalMinor : confirmTarget.priceMinor) === 0
                        ? 'Confirm Free Order'
                        : 'Record manual payment received'}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={closeConfirmDialog}
                    disabled={confirmBusy}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
