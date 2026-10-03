import {useListState} from '../../hooks/useListState.js';
import {ListSearch,Pagination} from '../../components/ListControls.jsx';
import {useState} from 'react';
import {useAuth} from '../../context/AuthContext.jsx';
import {useResource} from '../../hooks/useResource.js';
import {api} from '../../services/api.js';
import ModulePanel from '../../components/ModulePanel.jsx';
// @edit:ANNOUNCEMENTS_UI — text is rendered safely by React, never injected as HTML.
export default function AnnouncementsPage(){
 const {user}=useAuth(),list=useListState(),r=useResource('/browse/announcements?'+list.query),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const staff=user?.roles.includes('organizer');
 async function create(e){e.preventDefault();const f=e.currentTarget,v=Object.fromEntries(new FormData(f));setBusy(true);setError('');
 try{await api('/announcements',{method:'POST',body:v});f.reset();list.search('');r.reload();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function publish(id){setBusy(true);setError('');try{await api('/announcements/'+id+'/publish',{method:'POST',body:{}});r.reload();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <ModulePanel title="Announcements" description="News, upcoming activities and updates from your club." resource={r}>
 <ListSearch list={list} label="Search announcements"/>{error&&<p role="alert">{error}</p>}
 {staff&&<form className="form-card module-form" onSubmit={create}><h2>Write an announcement</h2>
 <label>Title<input name="title" minLength="3" maxLength="160" required/></label>
 <label>Message<textarea name="body" minLength="3" maxLength="10000" required/></label>
 <label>Audience<select name="audience"><option value="public">Everyone</option><option value="members">Signed-in community</option></select></label>
 <button className="button" disabled={busy}>Save draft</button></form>}
 <div className="module-grid">{r.data?.data.map(a=><article className="form-card" key={a.id}><span className="status-pill">{a.status}</span><h2>{a.title}</h2><p className="preserve-lines">{a.body}</p><small>{a.audience==='public'?'Public':'Signed-in community'}</small>
 {staff&&a.status==='draft'&&<button disabled={busy} className="button" onClick={()=>publish(a.id)}>Publish</button>}</article>)}</div>
 {!r.loading&&r.data?.data.length===0&&<p>No announcements yet.</p>}
 <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="announcements"/></ModulePanel>;
}
