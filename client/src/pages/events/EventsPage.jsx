import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../../services/api.js';
import {money,date} from '../../utils/format.js';
import {useAuth} from '../../context/AuthContext.jsx';

// @edit:EVENT_LIST — public listing and organizer view share pagination and error states.
export default function EventsPage({manage=false}){
 const [result,setResult]=useState(null),[error,setError]=useState(''),[page,setPage]=useState(1),[retry,setRetry]=useState(0);
 const {user}=useAuth();
 useEffect(()=>{const controller=new AbortController();setResult(null);setError('');api(`${manage?'/organizer':''}/events?page=${page}&pageSize=12`,{signal:controller.signal}).then(setResult).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[page,manage,retry]);
 return <section className="container account-page"><div className="section-heading"><div><p className="eyebrow">MAKE TIME FOR SOMETHING GREAT</p><h1>{manage?'Manage events':'Campus, connected.'}</h1><p className="muted">{manage?'Create, publish and update association events.':'Find your next gathering, workshop or celebration.'}</p></div>{user?.roles.includes('organizer')&&<Link className="button" to={manage?'/events/new':'/organizer/events'}>{manage?'Create event':'Manage events'}</Link>}</div>
 {error&&<p role="alert" className="form-error">{error} <button className="text-button" onClick={()=>setRetry(retry+1)}>Retry</button></p>}
 {!result&&!error&&<p role="status">Loading events…</p>}
 {result&&<>{!result.data.length?<div className="form-card"><h2>No events to show yet</h2><p>Check back soon for the next association event.</p></div>:<div className="event-grid">{result.data.map(event=><EventCard key={event.id} event={event} manage={manage}/>)}</div>}<div className="pagination"><button className="button button-secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page} · {result.pagination.total} events</span><button className="button button-secondary" disabled={page*12>=result.pagination.total} onClick={()=>setPage(page+1)}>Next</button></div></>}
 </section>;
}
// @edit:EVENT_CARD — presentation only; real availability and prices come from the API.
function EventCard({event,manage}){return <article className="form-card event-card"><div className="event-banner"><span>{new Date(event.startsAt).toLocaleDateString('en-GB',{month:'short',day:'numeric'})}</span><span className="status-pill">{manage?event.status:new Date(event.startsAt)<=new Date()?'Closed':`${event.seatsAvailable} seats left`}</span></div><h2>{event.title}</h2><p className="muted">{event.venue}</p><p>{date(event.startsAt)}</p><p className="event-excerpt">{event.description||'Join your association for this event.'}</p><p>Standard {money(event.publicPriceMinor,event.currency)}<br/><small className="muted">Active members {money(event.memberPriceMinor,event.currency)}</small></p><Link className="button button-secondary" to={manage?`/events/${event.id}/edit`:`/events/${event.id}`}>{manage?'Edit event':'View event'}</Link></article>;}
