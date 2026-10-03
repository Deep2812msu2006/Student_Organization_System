import {useListState} from '../../hooks/useListState.js';
import {ListSearch,Pagination} from '../../components/ListControls.jsx';
import {useState,useRef} from 'react';
import {api} from '../../services/api.js';
import {useResource} from '../../hooks/useResource.js';
import {money} from '../../utils/format.js';
import ModulePanel from '../../components/ModulePanel.jsx';
// @edit:DUES_PAYMENT_UI
export default function DuesPage(){
 const list=useListState(),r=useResource('/browse/dues?'+list.query),[selected,setSelected]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),key=useRef(null);
 async function submit(e){e.preventDefault();setBusy(true);setError('');const v=Object.fromEntries(new FormData(e.currentTarget));
 const body={duesObligationId:selected.id,amountMinor:selected.amountMinor,currency:selected.currency,method:selected.amountMinor===0?'zero_price':v.method,externalReference:v.externalReference||null,notes:''};
 const payload=JSON.stringify(body);if(key.current?.payload!==payload)key.current={payload,value:crypto.randomUUID()};
 try{await api('/payments/dues/manual',{method:'POST',body,headers:{'Idempotency-Key':key.current.value}});setSelected(null);key.current=null;r.reload();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <ModulePanel title="Membership dues" description="Record money already received outside this website. This does not charge anyone." resource={r}>
 <ListSearch list={list} label="Search member name or email"/>{error&&<p role="alert">{error}</p>}
 {selected&&<form className="form-card module-form" onSubmit={submit}><h2>Record payment for {selected.userName}</h2><p>{money(selected.amountMinor,selected.currency)}</p>
 <label>Method<select name="method"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option></select></label>
 <label>Receipt / transfer reference<input name="externalReference" maxLength="200"/></label>
 <button className="button" disabled={busy}>Confirm payment received</button><button type="button" disabled={busy} onClick={()=>setSelected(null)}>Back</button></form>}
 <div className="module-grid">{r.data?.data.map(d=><article className="form-card" key={d.id}><h2>{d.userName}</h2><p>{d.userEmail}</p><p>{money(d.amountMinor,d.currency)}</p><button className="button" onClick={()=>{setSelected(d);setError('');key.current=null;}}>Record payment</button></article>)}</div>
 {r.data?.data.length===0&&<p>No pending dues.</p>}<Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="dues"/></ModulePanel>;
}
