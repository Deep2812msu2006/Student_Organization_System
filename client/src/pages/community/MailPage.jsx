import {useListState} from '../../hooks/useListState.js';
import {ListSearch,Pagination} from '../../components/ListControls.jsx';
import {useState} from 'react';
import {useResource} from '../../hooks/useResource.js';
import {api} from '../../services/api.js';
import ModulePanel from '../../components/ModulePanel.jsx';
// @edit:MAIL_PREFERENCES — preview delivery is never described as sent email.
export default function MailPage({staff=false}){
 const list=useListState(),r=useResource(staff?'/browse/mail?'+list.query:'/mail/preferences'),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 async function act(path,body,method='POST'){setBusy(true);setNotice('');try{await api(path,{method,body});setNotice('Saved. Mail uses local preview; no external email was sent.');r.reload();}catch(e){setNotice(e.message);}finally{setBusy(false);}}
 return <ModulePanel title={staff?'Mail & renewal reminders':'Mail preferences'} description="Local email preview is enabled for this prototype." resource={r}>
 {staff&&<ListSearch list={list} label="Search recipient, subject or status"/>}{notice&&<p role="status">{notice}</p>}
 {staff?<><div className="module-actions"><button className="button" disabled={busy} onClick={()=>act('/staff/reminders/run',{days:14})}>Queue renewal reminders</button><button className="button button-secondary" disabled={busy} onClick={()=>act('/staff/mail/preview',{})}>Process local previews</button></div>
 <div className="module-grid">{r.data?.data.map(m=><article className="form-card" key={m.id}><span className="status-pill">{m.status}</span><h2>{m.subject}</h2><p>{m.email}</p><p>{m.body}</p></article>)}</div>{r.data?.data.length===0&&<p>No queued messages. Members must opt in first.</p>}</>:
 <article className="form-card"><h2>Announcements and renewal reminders</h2><p>Status: {r.data?.data.subscribed?'Subscribed':'Not subscribed'}</p><p>You can unsubscribe here at any time. Queued messages are suppressed when you unsubscribe.</p><button className="button" disabled={busy||r.loading} onClick={()=>act('/mail/preferences',{subscribed:!r.data?.data.subscribed},'PUT')}>{r.data?.data.subscribed?'Unsubscribe':'Subscribe'}</button></article>}
 {staff&&<Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Mail"/>}</ModulePanel>;
}
