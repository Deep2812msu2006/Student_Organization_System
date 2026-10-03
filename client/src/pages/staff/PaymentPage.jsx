import { useState, useEffect } from 'react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { money, date } from '../../utils/format.js';

/**
 * @edit:PAYMENT_UI — Treasurer manual payment confirmation screen.
 *
 * This screen is clearly labeled as "Manual Payment Recording" —
 * not an online payment flow. It does not simulate a payment gateway
 * or collect card details.
 *
 * Workflow:
 * 1. Treasurer selects an event.
 * 2. System shows pending registrations with user name, amount and status.
 * 3. Treasurer enters payment method, reference, notes for a registration.
 * 4. System validates amount/currency, creates payment evidence,
 *    and confirms the registration in one transaction.
 *
 * Only accessible to organizer-role users (enforced both client-side and server-side).
 */
export default function PaymentPage() {
  const { user } = useAuth();
  const [eventId, setEventId] = useState('');
  const [events, setEvents] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmForm, setConfirmForm] = useState({
    method: 'cash',
    externalReference: '',
    notes: '',
  });
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [confirmError, setConfirmError] = useState('');

  // Load organizer events
  useEffect(() => {
    const controller = new AbortController();
    api('/organizer/events?pageSize=50', { signal: controller.signal })
      .then(r => setEvents(r.data))
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, []);

  // Load pending registrations when event changes
  useEffect(() => {
    if (!eventId) { setPending(null); return; }
    const controller = new AbortController();
    setError('');
    api(`/events/${eventId}/pending-registrations`, { signal: controller.signal })
      .then(r => setPending(r.data))
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [eventId, confirmResult]);

  function openConfirmDialog(registration) {
    setConfirmTarget(registration);
    setConfirmForm({
      method: registration.priceMinor === 0 ? 'zero_price' : 'cash',
      externalReference: '',
      notes: '',
    });
    setConfirmError('');
    setConfirmResult(null);
  }

  function generateIdempotencyKey() {
    // Generate a unique key from timestamp + random for idempotency
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 12);
    return `pay_${timestamp}_${random}`.padEnd(16, '0');
  }

  async function handleConfirmPayment(e) {
    e.preventDefault();
    if (!confirmTarget) return;
    setConfirmBusy(true); setConfirmError(''); setConfirmResult(null);
    try {
      const res = await api('/payments/manual', {
        method: 'POST',
        body: {
          registrationId: confirmTarget.id,
          amountMinor: confirmTarget.priceMinor,
          currency: confirmTarget.currency,
          method: confirmForm.method,
          ...(confirmForm.externalReference ? { externalReference: confirmForm.externalReference } : {}),
          notes: confirmForm.notes,
        },
        headers: {
          'Idempotency-Key': generateIdempotencyKey(),
        },
      });
      setConfirmResult({
        success: true,
        replayed: res.replayed,
        data: res.data,
      });
      // Clear the dialog after success
      setTimeout(() => {
        setConfirmTarget(null);
        setConfirmResult(null);
      }, 3000);
    } catch (err) {
      setConfirmError(err.message);
    } finally {
      setConfirmBusy(false);
    }
  }

  const selectedEvent = events?.find(ev => ev.id === eventId);

  return (
    <section className="container account-page">
      <p className="eyebrow">TREASURER OPERATIONS</p>
      <h1>Manual Payment Recording</h1>
      <p className="muted">
        Record payments received outside the website. This is <strong>not</strong> an online payment processor —
        it records evidence of payment that was collected in person or via bank transfer.
      </p>

      <div className="form-card">
        <div className="field">
          <label htmlFor="payment-event">Event</label>
          <select
            id="payment-event"
            value={eventId}
            onChange={e => { setEventId(e.target.value); setConfirmTarget(null); }}
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

        {error && <p className="form-error" role="alert">{error}</p>}

        {eventId && !pending && !error && <p role="status">Loading pending registrations…</p>}

        {pending?.length === 0 && (
          <div className="status-message success">
            <strong>All caught up</strong>
            <p>No pending registrations for this event. All reservations have been confirmed or cancelled.</p>
          </div>
        )}
      </div>

      {/* Pending registrations list */}
      {pending?.length > 0 && (
        <div className="pending-list">
          <h2>Pending Registrations ({pending.length})</h2>
          <div className="event-grid tickets-grid">
            {pending.map(reg => (
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
                  className="button"
                  onClick={() => openConfirmDialog(reg)}
                  disabled={confirmTarget?.id === reg.id && confirmBusy}
                >
                  {reg.priceMinor === 0 ? 'Confirm (Free)' : 'Record Payment'}
                </button>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Payment confirmation dialog */}
      {confirmTarget && (
        <div className="payment-dialog-overlay" onClick={e => { if (e.target === e.currentTarget && !confirmBusy) setConfirmTarget(null); }}>
          <div className="payment-dialog form-card" role="dialog" aria-labelledby="payment-dialog-title">
            <h2 id="payment-dialog-title">
              {confirmTarget.priceMinor === 0 ? 'Confirm Free Registration' : 'Record Payment'}
            </h2>
            <p>
              <strong>{confirmTarget.userName}</strong> — {money(confirmTarget.priceMinor, confirmTarget.currency)}
            </p>

            {confirmResult?.success ? (
              <div className="checkin-result checkin-success" role="alert">
                <div className="checkin-result-icon">✓</div>
                <strong>{confirmResult.replayed ? 'Already confirmed (replay)' : 'Payment confirmed'}</strong>
                <p>Registration is now confirmed. The attendee will see their admission code.</p>
              </div>
            ) : (
              <form onSubmit={handleConfirmPayment}>
                {confirmTarget.priceMinor > 0 && (
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
                        placeholder="Receipt number, transaction ID…"
                        maxLength={200}
                      />
                    </div>
                  </>
                )}
                <div className="field">
                  <label htmlFor="payment-notes">Notes (optional)</label>
                  <textarea
                    id="payment-notes"
                    value={confirmForm.notes}
                    onChange={e => setConfirmForm({ ...confirmForm, notes: e.target.value })}
                    placeholder="Optional notes about this payment…"
                    rows={2}
                    maxLength={500}
                  />
                </div>

                {confirmError && <p className="form-error" role="alert">{confirmError}</p>}

                <div className="payment-dialog-actions">
                  <button className="button" type="submit" disabled={confirmBusy}>
                    {confirmBusy ? 'Recording…' : confirmTarget.priceMinor === 0 ? 'Confirm Free Entry' : `Confirm ${money(confirmTarget.priceMinor, confirmTarget.currency)} Received`}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => setConfirmTarget(null)}
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
