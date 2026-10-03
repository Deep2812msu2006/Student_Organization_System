import {Link} from 'react-router-dom';
import {money,date} from '../../utils/format.js';
import {useAuth} from '../../context/AuthContext.jsx';
import {useListState} from '../../hooks/useListState.js';
import {useResource} from '../../hooks/useResource.js';
import {ListSearch,Pagination,EmptyList} from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
// @edit:EVENT_LIST
export default function EventsPage({manage=false}){
 const list=useListState(),r=useResource('/browse/'+(manage?'manage-events':'events')+'?'+list.query),{user}=useAuth();
 return <ModulePanel title={manage?'Manage events':'Campus, connected.'} description={manage?'Create, publish and manage your association’s events.':'Make room for new ideas, good company and memorable evenings.'} resource={r}>
 <ListSearch list={list} label="Search events or venues">{user?.roles.includes('organizer')&&<Link className="button button-secondary" to={manage?'/events/new':'/organizer/events'}>{manage?'Create event':'Manage events'}</Link>}</ListSearch>
 <div className="event-grid">{!r.loading&&r.data?.data.map(event=><EventCard key={event.id} event={event} manage={manage}/>)}</div>
 {!r.loading&&r.data?.data.length===0&&<EmptyList title={list.q?'No matching events':'Your next event starts here'} message={list.q?'Try another title or venue.':'New activities will appear here when published.'}/>}
 <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Events"/>
 </ModulePanel>;
}
// @edit:EVENT_CARD
function EventCard({event,manage}){return <article className="form-card event-card"><div className="event-banner"><span>{new Date(event.startsAt).toLocaleDateString('en-GB',{month:'short',day:'numeric'})}</span><span className="status-pill">{manage?event.status:new Date(event.startsAt)<=new Date()?'Closed':event.seatsAvailable+' seats left'}</span></div><h2>{event.title}</h2><p className="muted">{event.venue}</p><p>{date(event.startsAt)}</p><p className="event-excerpt">{event.description||'Join your association for this event.'}</p><p>Standard {money(event.publicPriceMinor,event.currency)}<br/><small className="muted">Active members {money(event.memberPriceMinor,event.currency)}</small></p><Link className="button button-secondary" to={manage?'/events/'+event.id+'/edit':'/events/'+event.id}>{manage?'Edit event':'View event'}</Link></article>;}
