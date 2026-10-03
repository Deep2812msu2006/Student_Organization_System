import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api.js';
import { useListState } from '../../hooks/useListState.js';
import { useResource } from '../../hooks/useResource.js';
import { ListSearch, Pagination } from '../../components/ListControls.jsx';
import { date } from '../../utils/format.js';

/**
 * @edit:CHECKIN_UI — Staff check-in screen.
 *
 * Provides manual admission-code entry as primary input method.
 * Shows database-backed attendance totals.
 * Clearly distinguishes successful, already-used, invalid and ineligible tickets.
 *
 * Only accessible to organizer-role users (enforced both client-side and server-side).
 */
export default function CheckInPage() {
  const list = useListState();
  const eventResource = useResource('/browse/manage-events?' + list.query);
  const events = eventResource.data?.data;
  const [eventId, setEventId] = useState('');
  const [ticketToken, setTicketToken] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attendance, setAttendance] = useState(null);
  const [attendanceError, setAttendanceError] = useState('');
  const tokenInput = useRef(null);

  // @flow:CHECKIN_EVENT_SEARCH — paging makes events beyond the first 50 reachable.
  // Clear selection when the search changes to avoid admitting to a hidden event.
  useEffect(() => {
    setEventId(''); setResult(null); setError('');
  }, [list.query]);

  // Load attendance when event changes
  useEffect(() => {
    if (!eventId) { setAttendance(null); return; }
    const controller = new AbortController();
    setAttendance(null);
    setAttendanceError('');
    api(`/events/${eventId}/attendance`, { signal: controller.signal })
      .then(r => setAttendance(r.data))
      .catch(e => { if (e.name !== 'AbortError') setAttendanceError(e.message); });
    return () => controller.abort();
  }, [eventId, result]);

  async function handleCheckIn(e) {
    e.preventDefault();
    if (!eventId || !ticketToken.trim()) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const res = await api('/checkins', {
        method: 'POST',
        body: { eventId, ticketToken: ticketToken.trim() },
      });
      setResult({ success: true, data: res.data });
      setTicketToken('');
      tokenInput.current?.focus();
    } catch (err) {
      if (err.status === 409) {
        setResult({ success: false, code: err.message });
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function refreshAttendance() {
    if (!eventId) return;
    setAttendanceError('');
    api(`/events/${eventId}/attendance`)
      .then(r => setAttendance(r.data))
      .catch(e => setAttendanceError(e.message));
  }

  return (
    <section className="container account-page">
      <p className="eyebrow">STAFF OPERATIONS</p>
      <h1>Ticket Check-In</h1>
      <p className="muted">
        Scan or enter admission codes to check in attendees. Only confirmed tickets are admitted.
      </p>

      <ListSearch list={list} label="Search check-in events" />
      {eventResource.error && <p role="alert" className="form-error">{eventResource.error.message || eventResource.error}</p>}
      <Pagination list={list} pagination={eventResource.data?.pagination} loading={eventResource.loading} label="Check-in events" />
      <form className="checkin-form form-card" onSubmit={handleCheckIn}>
        <div className="field">
          <label htmlFor="checkin-event">Event</label>
          <select
            id="checkin-event"
            value={eventId}
            onChange={e => { setEventId(e.target.value); setResult(null); setError(''); }}
            required
          >
            <option value="">Select an event…</option>
            {events?.filter(ev => ev.status === 'published').map(ev => (
              <option key={ev.id} value={ev.id}>{ev.title}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="checkin-token">Admission Code</label>
          <input
            ref={tokenInput}
            id="checkin-token"
            type="text"
            value={ticketToken}
            onChange={e => setTicketToken(e.target.value)}
            placeholder="Enter or scan admission code (e.g. sky1_…)"
            autoComplete="off"
            autoFocus
            required
          />
          <small className="muted">
            Enter the full admission code from the attendee's ticket. Codes start with <code>sky1_</code>.
          </small>
        </div>

        <button className="button" type="submit" disabled={busy || !eventId || !ticketToken.trim()}>
          {busy ? 'Checking in…' : '✓ Check In'}
        </button>
      </form>

      {/* Check-in result feedback */}
      {result && (
        <div className={`checkin-result ${result.success ? 'checkin-success' : 'checkin-denied'}`} role="alert">
          {result.success ? (
            <>
              <div className="checkin-result-icon">✓</div>
              <strong>Admission granted</strong>
              <p>Registration {result.data.registrationId?.slice(0, 8)}… checked in at {date(result.data.checkedInAt)}.</p>
            </>
          ) : (
            <>
              <div className="checkin-result-icon">✕</div>
              <strong>Admission denied</strong>
              <p>{result.code}</p>
            </>
          )}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {/* Attendance totals */}
      {eventId && (
        <div className="attendance-panel form-card">
          <div className="attendance-header">
            <h2>Attendance</h2>
            <button className="button button-secondary" onClick={refreshAttendance} type="button">
              Refresh
            </button>
          </div>
          {attendanceError && <p className="form-error">{attendanceError}</p>}
          {attendance && (
            <div className="attendance-grid">
              <div className="attendance-stat">
                <span className="attendance-number">{attendance.checkedIn}</span>
                <span className="attendance-label">Checked In</span>
              </div>
              <div className="attendance-stat">
                <span className="attendance-number">{attendance.confirmed}</span>
                <span className="attendance-label">Confirmed</span>
              </div>
              <div className="attendance-stat">
                <span className="attendance-number">{attendance.pending}</span>
                <span className="attendance-label">Pending</span>
              </div>
              <div className="attendance-stat">
                <span className="attendance-number">{attendance.capacity}</span>
                <span className="attendance-label">Capacity</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
