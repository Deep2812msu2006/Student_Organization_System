import { useState } from 'react';
import { Link } from 'react-router-dom';
import { money, date } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useListState } from '../../hooks/useListState.js';
import { useResource } from '../../hooks/useResource.js';
import { api } from '../../services/api.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
import { getEventImage } from '../../utils/images.js';

// @edit:EVENT_LIST
export default function EventsPage({ manage = false }) {
  const list = useListState();
  const r = useResource('/browse/' + (manage ? 'manage-events' : 'events') + '?' + list.query);
  const { user } = useAuth();
  const [deletingEvent, setDeletingEvent] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function handleDeleteEvent() {
    if (!deletingEvent) return;
    setDeleteBusy(true);
    try {
      await api('/events/' + deletingEvent.id, { method: 'DELETE' });
      setDeletingEvent(null);
      r.reload();
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <ModulePanel
      title={manage ? 'Manage events' : 'Campus, connected.'}
      description={
        manage
          ? 'Create, publish and manage your association’s events.'
          : 'Make room for new ideas, good company and memorable evenings.'
      }
      resource={r}
    >
      <ListSearch list={list} label="Search events or venues">
        {user?.roles.includes('organizer') && (
          <Link className="button button-secondary" to={manage ? '/events/new' : '/organizer/events'}>
            {manage ? 'Create event' : 'Manage events'}
          </Link>
        )}
      </ListSearch>

      <div className="event-grid">
        {!r.loading &&
          r.data?.data.map((event, index) => (
            <EventCard
              key={event.id}
              event={event}
              manage={manage}
              index={index}
              onDelete={(ev) => setDeletingEvent(ev)}
            />
          ))}
      </div>

      {/* Delete Event Confirmation Modal */}
      {deletingEvent && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 1000,
          padding: '1rem',
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '460px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🗑️</div>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', color: '#0f172a' }}>
              Delete Event?
            </h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#64748b', lineHeight: 1.5 }}>
              Are you sure you want to delete <strong>{deletingEvent.title}</strong>?
            </p>
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fee2e2',
              borderRadius: '8px',
              padding: '0.75rem',
              fontSize: '0.8rem',
              color: '#991b1b',
              marginBottom: '1.5rem',
              textAlign: 'left',
            }}>
              ⚠️ If this event has active ticket registrations, it will be safely marked as <strong>Cancelled</strong> rather than purged to preserve attendee records.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                className="button button-secondary"
                disabled={deleteBusy}
                onClick={() => setDeletingEvent(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button"
                style={{ background: '#dc2626', color: '#fff' }}
                disabled={deleteBusy}
                onClick={handleDeleteEvent}
              >
                {deleteBusy ? 'Deleting…' : 'Yes, Delete / Cancel Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!r.loading && r.data?.data.length === 0 && (
        <EmptyList
          title={list.q ? 'No matching events' : 'Your next event starts here'}
          message={list.q ? 'Try another title or venue.' : 'New activities will appear here when published.'}
        />
      )}

      <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Events" />
    </ModulePanel>
  );
}

// @edit:EVENT_CARD
function EventCard({ event, manage, index = 0, onDelete }) {
  const isPast = new Date(event.startsAt) <= new Date();
  const isLowSeats = !manage && !isPast && event.seatsAvailable <= 5;
  const imageUrl = getEventImage(event, index);
  const isBooked = event.userRegistrationStatus === 'confirmed';
  const isPending = event.userRegistrationStatus === 'pending';

  return (
    <article className="event-card">
      <div className="event-card-media">
        <img
          className="event-card-img"
          src={imageUrl}
          alt={event.title}
          loading="lazy"
        />
        <div className="event-card-media-overlay" aria-hidden="true" />
        <span className="event-badge-date">
          📅 {new Date(event.startsAt).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
        </span>
        {!manage && isBooked && (
          <span className="event-badge-booked">✓ Confirmed</span>
        )}
        {!manage && isPending && (
          <span className="event-badge-booked pending">⏳ Reserved</span>
        )}
        <span className={`event-badge-status ${isLowSeats ? 'low' : ''} ${isPast ? 'closed' : ''}`}>
          {manage
            ? event.status.toUpperCase()
            : isPast
            ? 'Closed'
            : isLowSeats
            ? `🔥 Only ${event.seatsAvailable} Left`
            : `${event.seatsAvailable} seats left`}
        </span>
      </div>

      <div className="event-card-content">
        <h2>{event.title}</h2>
        <div className="event-venue">
          <span aria-hidden="true">📍</span>
          <span>{event.venue}</span>
        </div>
        <div className="event-time">
          <span aria-hidden="true">🕒</span>
          <span>{date(event.startsAt)}</span>
        </div>
        <p className="event-excerpt">{event.description || 'Join your association for this event.'}</p>

        <div className="event-price-box">
          <div>
            <span className="muted" style={{ fontSize: '0.72rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Standard</span>
            <span className="event-price-standard">{money(event.publicPriceMinor, event.currency)}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="event-price-member">
              ✨ Member rate: {money(event.memberPriceMinor, event.currency)}
            </span>
          </div>
        </div>

        {!manage && isBooked && (
          <div className="event-card-booked-banner">
            <span>✓ You already booked this event</span>
            <Link to="/tickets" className="event-card-ticket-link">My Tickets →</Link>
          </div>
        )}

        {!manage && isPending && (
          <div className="event-card-booked-banner pending">
            <span>⏳ Reserved — Confirmation pending</span>
            <Link to="/tickets" className="event-card-ticket-link">My Tickets →</Link>
          </div>
        )}

        {manage ? (
          <div style={{ display: 'flex', gap: '0.5rem', width: '100%', marginTop: 'auto' }}>
            <Link
              className="button button-secondary"
              to={`/events/${event.id}/edit`}
              style={{ flex: 1, textAlign: 'center', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
            >
              ✏️ Edit event
            </Link>
            <button
              type="button"
              className="button"
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                padding: '0.45rem 0.85rem',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
              title="Delete or cancel event"
              onClick={() => onDelete?.(event)}
            >
              🗑️
            </button>
          </div>
        ) : (
          <Link
            className={`button ${!manage && isBooked ? 'button-booked' : 'button-secondary'}`}
            to={`/events/${event.id}`}
          >
            {isBooked
              ? '✓ Booked · View details ↗'
              : isPending
              ? '⏳ Reserved · View details ↗'
              : 'View event & Reserve ↗'}
          </Link>
        )}
      </div>
    </article>
  );
}
