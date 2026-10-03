import {useListState} from '../../hooks/useListState.js';
import {useResource} from '../../hooks/useResource.js';
import {ListSearch,Pagination,EmptyList} from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
import {money,date} from '../../utils/format.js';
// @edit:TICKET_LAYOUT — admission codes come only from the owner-scoped API.
export default function TicketsPage(){
 const list=useListState(),r=useResource('/browse/tickets?'+list.query);
 return <ModulePanel title="My Tickets" description="Your next experience, and every reservation along the way." resource={r}>
 <ListSearch list={list} label="Search event, venue or ticket status"><button className="button button-secondary" onClick={r.reload}>Refresh tickets</button></ListSearch>
 <div className="event-grid">{!r.loading&&r.data?.data.map(t=><article className="form-card ticket-card" key={t.id}><span className="status-pill">{t.checkedInAt?'Checked in':t.status==='pending'?'Pending confirmation':t.status}</span><h2>{t.eventTitle}</h2><p>{t.eventVenue} · {date(t.eventStartsAt)}</p><p>{money(t.priceMinor,t.currency)}</p><p className="reference">Reference: {t.id}</p>{t.admissionCode?<label>Admission code — show authorized event staff<textarea readOnly rows="3" value={t.admissionCode}/></label>:<p className="payment-note">{t.status==='pending'?'Your seat is reserved. Staff must confirm payment before admission.':t.codeStatus==='reissue_required'?'Contact your organizer for code reissue.':'No admission code is available for this event or ticket status.'}</p>}</article>)}</div>
 {!r.loading&&r.data?.data.length===0&&<EmptyList title="No tickets found" message="Reserve a place at an event or try another search."/>}
 <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Tickets"/>
 </ModulePanel>;
}
