import {useEffect,useRef,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {api} from '../../services/api.js';
import {useAuth} from '../../context/AuthContext.jsx';
import {money,date} from '../../utils/format.js';

export default function EventDetails(){
 const {id}=useParams();const {user}=useAuth();
 const [event,setEvent]=useState(null),[error,setError]=useState(''),[bookingError,setBookingError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[retry,setRetry]=useState(0);
 const key=useRef(null);
 useEffect(()=>{const controller=new AbortController();setEvent(null);setError('');setSaved(false);key.current=crypto.randomUUID();api(`/events/${id}`,{signal:controller.signal}).then(r=>setEvent(r.data)).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[id,user?.id,retry]);
 async function reserve(){setBusy(true);setBookingError('');try{await api(`/events/${id}/registrations`,{method:'POST',body:{},headers:{'Idempotency-Key':key.current}});setSaved(true);const next=await api(`/events/${id}`);setEvent(next.data);}catch(e){setBookingError(e.message);}finally{setBusy(false);}}
 return <section className="container account-page"><Link to="/events">← All events</Link>{error&&<p className="form-error" role="alert">{error} <button className="text-button" onClick={()=>setRetry(retry+1)}>Retry</button></p>}{!event&&!error&&<p role="status">Loading event…</p>}{event&&<><p className="eyebrow event-eyebrow">SKYLINE EXPERIENCES</p><h1>{event.title}</h1><div className="account-grid"><article><p className="event-description">{event.description||'More details will be shared by the organizer.'}</p><dl className="event-facts"><dt>Venue</dt><dd>{event.venue}</dd><dt>Starts</dt><dd>{date(event.startsAt)}</dd><dt>Ends</dt><dd>{date(event.endsAt)}</dd><dt>Available seats</dt><dd>{event.seatsAvailable} of {event.capacity}</dd></dl></article><aside className="form-card"><h2>Your reservation</h2><p className="plan-price">{money(event.eligiblePriceMinor,event.currency)}</p><p className="muted">{event.memberPriceEligible?'Active paid-member price applied.':'Standard price. Active paid members qualify for the member rate.'}</p><p>Member price: {money(event.memberPriceMinor,event.currency)}</p><p className="payment-note">A reservation holds one seat and remains pending. No payment is processed here; admission is enabled only after authorized confirmation.</p>{bookingError&&<p role="alert" className="form-error">{bookingError}</p>}{event.userRegistration ? (
  <div className="notice" role="status">
    ✓ You already have a {event.userRegistration.status === 'confirmed' ? 'confirmed ticket' : 'reservation'} for this event.{' '}
    <Link to="/tickets" style={{ fontWeight: 700, marginLeft: 'var(--space-2)' }}>View My Tickets →</Link>
  </div>
) : saved ? (
  <div className="notice" role="status">Seat reserved — pending confirmation. <Link to="/tickets">Open My Tickets</Link></div>
) : !event.bookingOpen ? (
  <p className="notice">{event.seatsAvailable===0?'This event is full.':'Registration is closed.'}</p>
) : user ? (
  <button className="button full-width" disabled={busy} onClick={reserve}>{busy?'Reserving…':'Reserve a seat'}</button>
) : (
  <Link className="button full-width" to="/login">Sign in to reserve</Link>
)}</aside></div></>}</section>;
}
