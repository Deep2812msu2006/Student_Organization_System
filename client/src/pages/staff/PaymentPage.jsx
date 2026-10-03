import {useState,useRef,useEffect} from 'react';
import {api} from '../../services/api.js';
import {useListState} from '../../hooks/useListState.js';
import {useResource} from '../../hooks/useResource.js';
import {ListSearch,Pagination,EmptyList} from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
import {money} from '../../utils/format.js';
// @edit:PAYMENT_UI @edit:MERCHANDISE_PAYMENT_UI
export default function PaymentPage(){
 const list=useListState(),[kind,setKind]=useState('merchandise'),r=useResource('/browse/'+(kind==='merchandise'?'pending-orders':'pending-registrations')+'?'+list.query);
 const [target,setTarget]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),key=useRef(null),focus=useRef(null);
 useEffect(()=>{if(target)focus.current?.focus();},[target]);
 function open(row){setTarget(row);setError('');setSuccess('');key.current=null;}
 function switchKind(k){setKind(k);list.search('');setTarget(null);setError('');}
 async function submit(e){
 e.preventDefault();setBusy(true);setError('');const v=Object.fromEntries(new FormData(e.currentTarget)),amount=kind==='merchandise'?target.totalMinor:target.priceMinor;
 const body={...(kind==='merchandise'?{orderId:target.id}:{registrationId:target.id}),amountMinor:amount,currency:target.currency,method:amount===0?'zero_price':v.method,notes:v.notes||'',...(v.externalReference?{externalReference:v.externalReference}:{})};
 const payload=JSON.stringify(body);if(key.current?.payload!==payload)key.current={payload,value:crypto.randomUUID()};
 try{await api(kind==='merchandise'?'/payments/merchandise/manual':'/payments/manual',{method:'POST',body,headers:{'Idempotency-Key':key.current.value}});setTarget(null);setSuccess('Manual payment recorded. The customer can refresh their order or ticket.');r.reload();}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <ModulePanel title="Manual payment recording" description="Record payments already received by club staff. No card or bank account is charged here." resource={r}>
 <div className="filter-chips" aria-label="Payment type"><button id="tab-merchandise" aria-pressed={kind==='merchandise'} onClick={()=>switchKind('merchandise')}>Merchandise orders</button><button id="tab-events" aria-pressed={kind==='event'} onClick={()=>switchKind('event')}>Event tickets</button></div>
 <ListSearch list={list} label={kind==='merchandise'?'Search customer, product or order':'Search customer or event'}/>
 {success&&<p className="notice" role="status">{success}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
 {target&&<form className="form-card module-form payment-editor" onSubmit={submit}><h2>Record manual payment received</h2><p>{target.userName} · {money(kind==='merchandise'?target.totalMinor:target.priceMinor,target.currency)}</p>
 <label>Payment Method<select ref={focus} name="method"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option></select></label>
 <label>External Reference (optional)<input name="externalReference" maxLength="200"/></label><label>Notes (optional)<textarea name="notes" maxLength="500"/></label>
 <div className="module-actions"><button id="submit-payment-confirmation" className="button" disabled={busy}>{busy?'Recording…':'Confirm payment received'}</button><button type="button" disabled={busy} onClick={()=>setTarget(null)}>Cancel</button></div></form>}
 <div className="module-grid">{!r.loading&&r.data?.data.map(row=><article className="form-card" key={row.id}><span className="status-pill">Awaiting payment</span><h2>{row.userName}</h2><p className="muted">{row.userEmail}</p><p className="reference">{row.id}</p>{row.eventTitle&&<h3>{row.eventTitle}</h3>}{row.items&&<ul>{row.items.map(i=><li key={i.id}>{i.quantity} × {i.productName} / {i.variantName}</li>)}</ul>}<p className="payment-amount">{money(kind==='merchandise'?row.totalMinor:row.priceMinor,row.currency)}</p><button className="button" disabled={busy} onClick={()=>open(row)}>Record manual payment received</button></article>)}</div>
 {!r.loading&&r.data?.data.length===0&&<EmptyList title="No pending payments" message="New unpaid orders and event reservations will appear here."/>}
 <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Pending payments"/>
 </ModulePanel>;
}
