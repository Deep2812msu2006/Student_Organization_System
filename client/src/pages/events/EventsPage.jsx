import { Link } from 'react-router-dom';
import { money, date } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useListState } from '../../hooks/useListState.js';
import { useResource } from '../../hooks/useResource.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
import { getEventImage } from '../../utils/images.js';

// @edit:EVENT_LIST
export default function EventsPage({ manage = false }) {
  const list = useListState();
  const r = useResource('/browse/' + (manage ? 'manage-events' : 'events') + '?' + list.query);
  const { user } = useAuth();

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
            <EventCard key={event.id} event={event} manage={manage} index={index} />
          ))}
      </div>

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
function EventCard({ event, manage, index = 0 }) {
  const isPast = new Date(event.startsAt) <= new Date();
  const isLowSeats = !manage && !isPast && event.seatsAvailable <= 5;
  const imageUrl = getEventImage(event, index);

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

        <Link
          className="button button-secondary"
          to={manage ? `/events/${event.id}/edit` : `/events/${event.id}`}
        >
          {manage ? 'Edit event' : 'View event & Reserve ↗'}
        </Link>
      </div>
    </article>
  );
}
