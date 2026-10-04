import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api.js';
import { useListState } from '../../hooks/useListState.js';
import { useResource } from '../../hooks/useResource.js';
import { ListSearch, Pagination } from '../../components/ListControls.jsx';
import { date, money } from '../../utils/format.js';

// @edit:CHECKIN_UI — modern staff check-in kiosk terminal & live attendance dashboard
export default function CheckInPage() {
  const list = useListState();
  const eventResource = useResource('/browse/manage-events?' + list.query);
  const events = eventResource.data?.data || [];

  const [eventId, setEventId] = useState('');
  const [ticketToken, setTicketToken] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attendance, setAttendance] = useState(null);
  const [attendanceError, setAttendanceError] = useState('');
  const [recentCheckIns, setRecentCheckIns] = useState([]);
  const tokenInput = useRef(null);

  // Clear selection when the search changes
  useEffect(() => {
    setEventId('');
    setResult(null);
    setError('');
  }, [list.query]);

  // Auto-select first event if none selected
  useEffect(() => {
    if (!eventId && events.length > 0) {
      const published = events.find((ev) => ev.status === 'published');
      if (published) setEventId(published.id);
    }
  }, [events, eventId]);

  // Load attendance when event changes or after a check-in
  useEffect(() => {
    if (!eventId) {
      setAttendance(null);
      return;
    }
    const controller = new AbortController();
    setAttendance(null);
    setAttendanceError('');
    api(`/events/${eventId}/attendance`, { signal: controller.signal })
      .then((r) => setAttendance(r.data))
      .catch((e) => {
        if (e.name !== 'AbortError') setAttendanceError(e.message);
      });
    return () => controller.abort();
  }, [eventId, result]);

  async function handleCheckIn(e) {
    e.preventDefault();
    if (!eventId || !ticketToken.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    const token = ticketToken.trim();
    try {
      const res = await api('/checkins', {
        method: 'POST',
        body: { eventId, ticketToken: token },
      });
      const checkinData = res.data;
      setResult({ success: true, data: checkinData });
      setRecentCheckIns((prev) => [
        {
          id: checkinData.registrationId,
          time: new Date().toLocaleTimeString(),
          token: token.slice(0, 14) + '…',
          status: 'granted',
        },
        ...prev.slice(0, 7),
      ]);
      setTicketToken('');
      tokenInput.current?.focus();
    } catch (err) {
      if (err.status === 409) {
        setResult({ success: false, code: err.message });
        setRecentCheckIns((prev) => [
          {
            id: 'Failed Attempt',
            time: new Date().toLocaleTimeString(),
            token: token.slice(0, 14) + '…',
            status: 'denied',
            reason: err.message,
          },
          ...prev.slice(0, 7),
        ]);
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
      .then((r) => setAttendance(r.data))
      .catch((e) => setAttendanceError(e.message));
  }

  const selectedEvent = events.find((ev) => ev.id === eventId);
  const checkedInCount = attendance?.checkedIn || 0;
  const confirmedCount = attendance?.confirmed || 0;
  const arrivalRate = confirmedCount > 0 ? Math.round((checkedInCount / confirmedCount) * 100) : 0;

  return (
    <section className="container account-page" style={{ maxWidth: 1040, margin: '0 auto' }}>
      <p className="eyebrow">CAMPUS EVENT OPERATIONS</p>
      <h1>Ticket Admission & Check-In Kiosk</h1>
      <p className="muted">
        Optical barcode & QR admission reader. Only verified confirmed attendees are granted gate entry.
      </p>

      {/* Step 1: Active Event Selection Cards */}
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <strong style={{ fontSize: '1rem', color: '#0f172a' }}>
            1. Select Active Event
          </strong>
          {selectedEvent && (
            <span style={{ fontSize: '0.82rem', color: '#059669', fontWeight: 700 }}>
              ● Currently Active: {selectedEvent.title}
            </span>
          )}
        </div>

        <div className="checkin-events-selector-grid">
          {events
            .filter((ev) => ev.status === 'published')
            .map((ev) => {
              const isSelected = ev.id === eventId;
              return (
                <div
                  key={ev.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.click();}}}
                  className={`checkin-event-card ${isSelected ? 'active' : ''}`}
                  onClick={() => {
                    setEventId(ev.id);
                    setResult(null);
                    setError('');
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <h3 className="checkin-event-title">{ev.title}</h3>
                    {isSelected && (
                      <span
                        style={{
                          background: '#10b981',
                          color: '#ffffff',
                          borderRadius: '50%',
                          width: 20,
                          height: 20,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </div>

                  <div className="checkin-event-meta">
                    <span>📍 {ev.venue}</span>
                    <span>
                      📅{' '}
                      {new Date(ev.startsAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>

        <ListSearch list={list} label="Search more events by title or venue" />
        <Pagination
          list={list}
          pagination={eventResource.data?.pagination}
          loading={eventResource.loading}
          label="Check-in events"
        />
      </div>

      {/* Step 2: Scanner Terminal & Live Attendance Dashboard */}
      {selectedEvent && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
          {/* Scanner Console */}
          <div className="checkin-terminal-card">
            <div className="checkin-terminal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="finance-pulse-dot" />
                <strong style={{ fontSize: '1.1rem', color: '#0f172a' }}>
                  Admission Scanner Terminal
                </strong>
              </div>
              <span style={{ fontSize: '0.76rem', background: '#ecfdf5', color: '#065f46', padding: '0.25rem 0.65rem', borderRadius: '1rem', fontWeight: 700 }}>
                Gate Active
              </span>
            </div>

            <form onSubmit={handleCheckIn} className="checkin-scanner-box">
              <div style={{ textAlign: 'center' }}>
                <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.35rem' }}>
                  📷
                </span>
                <strong style={{ display: 'block', fontSize: '0.98rem', color: '#0f172a' }}>
                  Enter Ticket Admission Code
                </strong>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  Or enter admission token starting with <code>sky1_</code>
                </span>
              </div>

              <input
                aria-label="Admission Code"
                ref={tokenInput}
                type="text"
                value={ticketToken}
                onChange={(e) => setTicketToken(e.target.value)}
                placeholder="sky1_..."
                autoComplete="off"
                autoFocus
                required
              />

              <button
                type="submit"
                className="button"
                style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', background: '#163c34' }}
                disabled={busy || !ticketToken.trim()}
              >
                {busy ? 'Verifying Ticket…' : '✓ Admit Attendee'}
              </button>
            </form>

            {/* Check-in result feedback */}
            {result && (
              <div
                className={`checkin-result ${result.success ? 'checkin-success' : 'checkin-denied'}`}
                role="alert"
              >
                {result.success ? (
                  <>
                    <div className="checkin-result-icon">✓</div>
                    <strong>ADMISSION GRANTED</strong>
                    <p>
                      Ticket confirmed. Checked in at {date(result.data.checkedInAt)}.
                    </p>
                    <small style={{ color: '#065f46', fontWeight: 600 }}>
                      Reg ID: {result.data.registrationId?.slice(0, 8)}…
                    </small>
                  </>
                ) : (
                  <>
                    <div className="checkin-result-icon">✕</div>
                    <strong>ADMISSION DENIED</strong>
                    <p>{result.code}</p>
                    <small style={{ color: '#991b1b', fontWeight: 600 }}>
                      Ensure ticket belongs to this event and has not been used already.
                    </small>
                  </>
                )}
              </div>
            )}

            {error && <p className="form-error" role="alert">{error}</p>}

            {/* Recent Check-Ins Stream */}
            {recentCheckIns.length > 0 && (
              <div className="checkin-feed-box">
                <span className="checkin-feed-title">Recent Gate Activity</span>
                <div className="checkin-feed-list">
                  {recentCheckIns.map((ci, idx) => (
                    <div key={idx} className="checkin-feed-item">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <span>{ci.status === 'granted' ? '🟢' : '🔴'}</span>
                        <strong style={{ color: ci.status === 'granted' ? '#065f46' : '#991b1b' }}>
                          {ci.status === 'granted' ? 'Admitted' : 'Denied'}
                        </strong>
                        <span style={{ color: '#64748b' }}>({ci.token})</span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{ci.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Attendance Panel */}
          <div className="attendance-panel" style={{ margin: 0, height: 'fit-content' }}>
            <div className="attendance-header">
              <div>
                <h2>Live Attendance</h2>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  Real-time database head count
                </span>
              </div>
              <button
                className="button button-secondary"
                onClick={refreshAttendance}
                type="button"
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                🔄 Refresh
              </button>
            </div>

            {attendanceError && <p className="form-error">{attendanceError}</p>}

            {attendance && (
              <>
                {/* Visual Arrival Rate Progress Gauge */}
                <div className="attendance-progress-wrap">
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                    <strong style={{ color: '#0f172a' }}>Gate Arrival Progress</strong>
                    <strong style={{ color: '#10b981' }}>{arrivalRate}% Arrived</strong>
                  </div>
                  <div className="attendance-progress-bar">
                    <div
                      className="attendance-progress-fill"
                      style={{ width: `${arrivalRate}%` }}
                    />
                  </div>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {checkedInCount} of {confirmedCount} confirmed ticket holders checked in
                  </span>
                </div>

                <div className="attendance-grid">
                  <div className="attendance-stat">
                    <span className="attendance-number checked">{attendance.checkedIn}</span>
                    <span className="attendance-label">Checked In</span>
                  </div>
                  <div className="attendance-stat">
                    <span className="attendance-number confirmed">{attendance.confirmed}</span>
                    <span className="attendance-label">Confirmed</span>
                  </div>
                  <div className="attendance-stat">
                    <span className="attendance-number pending">{attendance.pending}</span>
                    <span className="attendance-label">Pending</span>
                  </div>
                  <div className="attendance-stat">
                    <span className="attendance-number">{attendance.capacity}</span>
                    <span className="attendance-label">Capacity</span>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: '1.25rem',
                    background: '#f8fafc',
                    border: '1px solid #f1f5f9',
                    borderRadius: '0.75rem',
                    padding: '0.85rem 1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                    Ticket Revenue Collected:
                  </span>
                  <strong style={{ fontSize: '1.1rem', color: '#0f172a' }}>
                    {money(attendance.ticketRevenueMinor || 0, attendance.currency || 'INR')}
                  </strong>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
