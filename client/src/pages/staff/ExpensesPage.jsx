import {useListState} from '../../hooks/useListState.js';
import {ListSearch,Pagination} from '../../components/ListControls.jsx';
import {useRef,useState} from 'react';
import {useAuth} from '../../context/AuthContext.jsx';
import {useResource} from '../../hooks/useResource.js';
import {api,uploadReceipt} from '../../services/api.js';
import {money} from '../../utils/format.js';
import ModulePanel from '../../components/ModulePanel.jsx';
// @edit:EXPENSES_UI — receipts are private and fetched through authorized endpoints.
export default function ExpensesPage(){
 const {user}=useAuth(),staff=user.roles.some(r=>['organizer','treasurer'].includes(r));
 const list=useListState(),r=useResource('/browse/expenses?'+list.query),[error,setError]=useState(''),[busy,setBusy]=useState(false),[action,setAction]=useState(null),keys=useRef({});
 async function submit(e){e.preventDefault();const f=e.currentTarget,v=new FormData(f);setBusy(true);setError('');
 try{const file=v.get('receipt');if(file.size>5*1024*1024)throw new Error('Receipt must be 5 MB or smaller.');
 const receipt=await uploadReceipt(file);
 await api('/expenses',{method:'POST',body:{amountMinor:Math.round(Number(v.get('amount'))*100),currency:v.get('currency'),purpose:v.get('purpose'),receiptKey:receipt.data.receiptKey}});
 f.reset();list.search('');r.reload();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function decide(e){e.preventDefault();setBusy(true);setError('');const v=Object.fromEntries(new FormData(e.currentTarget));
 const path='/expenses/'+action.id+(action.type==='reimburse'?'/reimburse':'/decision');
 const body=action.type==='reimburse'?{reimbursementReference:v.reason||null}:{decision:action.type,reason:v.reason||''};
 const payload=JSON.stringify(body);if(keys.current[path]?.payload!==payload)keys.current[path]={payload,key:crypto.randomUUID()};
 try{await api(path,{method:'POST',body,headers:{'Idempotency-Key':keys.current[path].key}});setAction(null);r.reload();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <ModulePanel title={staff?'Expense claims':'My expenses'} description="Submit receipts and track review and reimbursement." resource={r}>
 <ListSearch list={list} label="Search purpose, name or status"/>{error&&<p role="alert">{error}</p>}
 <details className="form-card"><summary>Submit an expense</summary><form className="module-form" onSubmit={submit}>
 <label>Purpose<input name="purpose" required minLength="3" maxLength="500"/></label>
 <label>Amount (major units)<input name="amount" type="number" min="0.01" step="0.01" max="10000000" required/></label>
 <label>Currency<select name="currency"><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></label>
 <label>Receipt (JPEG, PNG, WebP or PDF; up to 5 MB)<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required/></label>
 <button className="button" disabled={busy}>Submit expense</button></form></details>
 {action&&<form className="form-card module-form" onSubmit={decide}><h2>{action.type==='reimburse'?'Record reimbursement':action.type==='approved'?'Approve expense':'Reject expense'}</h2>
 <label>{action.type==='reimburse'?'Payment reference':'Reason'}<input name="reason" maxLength="200" required={action.type==='rejected'}/></label><button className="button" disabled={busy}>Confirm</button><button type="button" onClick={()=>setAction(null)}>Back</button></form>}
 <div className="module-grid">{r.data?.data.map(x=><article className="form-card" key={x.id}><span className="status-pill">{x.status}</span><h2>{x.purpose}</h2><p>{x.requesterName}</p><p>{money(x.amountMinor,x.currency)}</p><a href={'/api/v1/expenses/'+x.id+'/receipt'} target="_blank" rel="noreferrer">View private receipt</a>
 {staff&&x.requesterId!==user.id&&<div className="module-actions">{x.status==='submitted'&&<><button onClick={()=>setAction({id:x.id,type:'approved'})}>Approve</button><button onClick={()=>setAction({id:x.id,type:'rejected'})}>Reject</button></>}{x.status==='approved'&&<button onClick={()=>setAction({id:x.id,type:'reimburse'})}>Record reimbursement</button>}</div>}</article>)}</div>
 {r.data?.data.length===0&&<p>No expenses yet.</p>}<Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="expenses"/></ModulePanel>;
}
