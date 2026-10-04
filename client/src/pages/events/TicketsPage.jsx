import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useListState } from '../../hooks/useListState.js';
import { useResource } from '../../hooks/useResource.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
import { money, date } from '../../utils/format.js';
import { getEventImage } from '../../utils/images.js';

// @edit:TICKET_LAYOUT — admission codes come only from owner-scoped API
export default function TicketsPage() {
  const list = useListState();
  const r = useResource('/browse/tickets?' + list.query);

  return (
    <ModulePanel
      title="My Tickets"
      description="Your next experience, and every reservation along the way."
      resource={r}
    >
      <ListSearch list={list} label="Search event, venue or ticket status">
        <button className="button button-secondary" onClick={r.reload}>
          Refresh tickets
        </button>
      </ListSearch>

      <div className="tickets-container">
        {!r.loading &&
          r.data?.data.map((ticket, index) => (
            <TicketPass key={ticket.id} ticket={ticket} index={index} />
          ))}
      </div>

      {!r.loading && r.data?.data.length === 0 && (
        <EmptyList
          title="No tickets found"
          message="Reserve a place at an event or try another search."
        />
      )}

      <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Tickets" />
    </ModulePanel>
  );
}

function TicketPass({ ticket, index }) {
  const [copied, setCopied] = useState(false);
  const isCheckedIn = !!ticket.checkedInAt;
  const isConfirmed = ticket.status === 'confirmed' && !isCheckedIn;
  const isPending = ticket.status === 'pending';

  const imageUrl = getEventImage({ title: ticket.eventTitle }, index);

  function copyCode() {
    if (!ticket.admissionCode) return;
    navigator.clipboard.writeText(ticket.admissionCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  return (
    <article className="ticket-pass">
      {/* Visual Header with Event Photography */}
      <div className="ticket-pass-header">
        <img className="ticket-pass-img" src={imageUrl} alt={ticket.eventTitle} loading="lazy" />
        <div className="ticket-pass-overlay" />
        <div className="ticket-pass-badges">
          {isCheckedIn ? (
            <span className="ticket-status-pill checked-in">✓ Checked In</span>
          ) : isConfirmed ? (
            <span className="ticket-status-pill confirmed">✓ Confirmed</span>
          ) : (
            <span className="ticket-status-pill pending">⏳ Awaiting Confirmation</span>
          )}
          <span className="ticket-price-pill">
            {money(ticket.priceMinor, ticket.currency)}
          </span>
        </div>
        <div className="ticket-pass-brand">Skyline Pass · Official Admission</div>
      </div>

      {/* Main Pass Content */}
      <div className="ticket-pass-content">
        <h2 className="ticket-pass-title">{ticket.eventTitle}</h2>

        <div className="ticket-info-grid">
          <div className="ticket-info-item">
            <span aria-hidden="true">📍</span>
            <span>{ticket.eventVenue}</span>
          </div>
          <div className="ticket-info-item">
            <span aria-hidden="true">🕒</span>
            <span>{date(ticket.eventStartsAt)}</span>
          </div>
        </div>

        <div className="ticket-ref-box">
          <span>Ref: {ticket.id?.slice(0, 18)}…</span>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            {ticket.currency}
          </span>
        </div>
      </div>

      {/* Ticket Perforation Tear-off Divider */}
      <div className="ticket-perforation" aria-hidden="true">
        <div className="ticket-perforation-line" />
      </div>

      {/* Stub / Admission Area */}
      <div className="ticket-stub">
        {ticket.admissionCode ? (
          <div className="ticket-qr-section">
            {/* Crisp Scalable Barcode/QR Graphic */}
            <div className="ticket-qr-graphic" title="Admission Pass Barcode">
              <svg viewBox="0 0 48 48" width="56" height="56" fill="white">
                {/* 3 Corner Finder Squares */}
                <rect x="4" y="4" width="14" height="14" rx="2" fill="none" stroke="white" strokeWidth="2.5" />
                <rect x="7.5" y="7.5" width="7" height="7" fill="white" />

                <rect x="30" y="4" width="14" height="14" rx="2" fill="none" stroke="white" strokeWidth="2.5" />
                <rect x="33.5" y="7.5" width="7" height="7" fill="white" />

                <rect x="4" y="30" width="14" height="14" rx="2" fill="none" stroke="white" strokeWidth="2.5" />
                <rect x="7.5" y="33.5" width="7" height="7" fill="white" />

                {/* Simulated Data Matrix Dots */}
                <rect x="22" y="6" width="3" height="3" fill="white" />
                <rect x="22" y="12" width="3" height="3" fill="white" />
                <rect x="6" y="22" width="3" height="3" fill="white" />
                <rect x="12" y="22" width="3" height="3" fill="white" />
                <rect x="18" y="20" width="4" height="4" fill="white" />
                <rect x="26" y="20" width="4" height="4" fill="white" />
                <rect x="22" y="27" width="4" height="4" fill="white" />
                <rect x="31" y="22" width="3" height="3" fill="white" />
                <rect x="38" y="22" width="3" height="3" fill="white" />
                <rect x="22" y="35" width="3" height="3" fill="white" />
                <rect x="22" y="41" width="3" height="3" fill="white" />
                <rect x="32" y="32" width="4" height="4" fill="white" />
                <rect x="39" y="35" width="3" height="3" fill="white" />
                <rect x="34" y="40" width="4" height="4" fill="white" />
              </svg>
            </div>

            <div className="ticket-code-details">
              <span className="ticket-code-label">Admission Code</span>
              <div className="ticket-code-display">{ticket.admissionCode}</div>
              <button
                type="button"
                className={`ticket-copy-btn ${copied ? 'copied' : ''}`}
                onClick={copyCode}
              >
                {copied ? '✓ Copied to clipboard' : '📋 Copy code'}
              </button>
            </div>
          </div>
        ) : isCheckedIn ? (
          <div className="ticket-admitted-box">
            <div className="ticket-admitted-stamp">
              <span>✓</span> ADMISSION VERIFIED
            </div>
            <p className="ticket-admitted-desc">
              Admitted at {date(ticket.checkedInAt)}. Thank you for joining!
            </p>
          </div>
        ) : isPending ? (
          <div className="ticket-pending-box">
            <div className="ticket-pending-title">
              <span>⏳</span> Seat Held · Confirmation Pending
            </div>
            <p className="ticket-pending-desc">
              Your reservation is safe. An organizer or treasurer will verify payment to issue your admission code.
            </p>
          </div>
        ) : (
          <div className="ticket-pending-box">
            <p className="ticket-pending-desc">
              {ticket.codeStatus === 'reissue_required'
                ? 'Contact association staff for admission code reissue.'
                : 'No admission code is active for this status.'}
            </p>
          </div>
        )}

        {/* Footer Actions */}
        <div className="ticket-pass-actions">
          {ticket.eventId && (
            <Link className="button button-secondary" to={`/events/${ticket.eventId}`}>
              View Event Details ↗
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
