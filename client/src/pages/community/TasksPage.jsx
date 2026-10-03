import {useListState} from '../../hooks/useListState.js';
import {ListSearch,Pagination} from '../../components/ListControls.jsx';
import {useState,useEffect} from 'react';
import {useAuth} from '../../context/AuthContext.jsx';
import {useResource} from '../../hooks/useResource.js';
import {api} from '../../services/api.js';
import ModulePanel from '../../components/ModulePanel.jsx';
// @edit:TASKS_UI
export default function TasksPage(){
 const {user}=useAuth(),list=useListState(),r=useResource('/browse/tasks?'+list.query),staff=user.roles.includes('organizer');
 const [people,setPeople]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(staff)api('/tasks/assignees').then(v=>setPeople(v.data)).catch(e=>setError(e.message));},[staff]);
 async function create(e){e.preventDefault();const f=e.currentTarget,v=Object.fromEntries(new FormData(f));v.dueAt=v.dueAt?new Date(v.dueAt).toISOString():null;setBusy(true);setError('');
 try{await api('/tasks',{method:'POST',body:v});f.reset();list.search('');r.reload();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function update(id,status){setBusy(true);setError('');try{await api('/tasks/'+id,{method:'PATCH',body:{status}});r.reload();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <ModulePanel title={staff?'Volunteer tasks':'My tasks'} description="Keep assignments and progress in one place." resource={r}>
 <ListSearch list={list} label="Search tasks or assignees"/>{error&&<p role="alert">{error}</p>}
 {staff&&<form className="form-card module-form" onSubmit={create}><h2>Assign a task</h2>
 <label>Title<input name="title" minLength="3" maxLength="160" required/></label><label>Description<textarea name="description" maxLength="3000"/></label>
 <label>Assign to<select name="assigneeId" required><option value="">Choose a person</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label>Due date (your local time)<input type="datetime-local" name="dueAt"/></label><button className="button" disabled={busy}>Create task</button></form>}
 <div className="module-grid">{r.data?.data.map(t=><article className="form-card" key={t.id}><h2>{t.title}</h2><p>{t.description}</p><p>Assigned to {t.assigneeName}</p><p>{t.dueAt?'Due '+new Date(t.dueAt).toLocaleString():'No due date'}</p>
 <label>Progress<select aria-label={'Progress for '+t.title} value={t.status} disabled={busy} onChange={e=>update(t.id,e.target.value)}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label></article>)}</div>
 {!r.loading&&r.data?.data.length===0&&<p>No tasks assigned yet.</p>}<Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="tasks"/></ModulePanel>;
}
