import {useListState} from '../../hooks/useListState.js';
import {ListSearch,Pagination} from '../../components/ListControls.jsx';
import {useState} from 'react';
import {api} from '../../services/api.js';
import {useResource} from '../../hooks/useResource.js';
import {money} from '../../utils/format.js';
import ModulePanel from '../../components/ModulePanel.jsx';
// @edit:INVENTORY_UI
export default function InventoryPage(){
 const list=useListState(),collection=useListState('collection'),r=useResource('/browse/inventory?'+list.query),orders=useResource('/browse/fulfillment?'+collection.query),catalog=useResource('/staff/inventory'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function request(path,body){setBusy(true);setError('');try{await api(path,{method:'POST',body});r.reload();orders.reload();catalog.reload();return true;}catch(e){setError(e.message);return false;}finally{setBusy(false);}}
 async function create(e){e.preventDefault();const form=e.currentTarget,v=Object.fromEntries(new FormData(form));v.priceMinor=Math.round(Number(v.price)*100);delete v.price;v.stock=Number(v.stock);if(!v.productId)delete v.productId;
 if(await request('/staff/products',v)){form.reset();list.search('');}}
 return <ModulePanel title="Inventory & fulfillment" description="Manage sizes and stock, then record collection of paid orders." resource={r}>
 <ListSearch list={list} label="Search product, size or SKU"/>{error&&<p role="alert">{error}</p>}
 <details className="form-card"><summary>Add a product or size</summary><form className="module-form" onSubmit={create}>
 <label>Existing product (optional)<select name="productId"><option value="">Create new product</option>{[...new Map((catalog.data?.data||[]).map(p=>[p.id,p])).values()].map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label>Product name<input name="name" minLength="3" maxLength="100" required/></label><label>Description<textarea name="description" maxLength="3000"/></label>
 <label>Size / variant<input name="size" maxLength="50" required/></label><label>Price<input name="price" type="number" min="0" step="0.01" max="1000000" required/></label>
 <label>Currency<select name="currency"><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><label>Initial stock<input name="stock" type="number" min="0" max="100000" step="1" required/></label><button className="button" disabled={busy}>Save variant</button></form></details>
 <div className="module-grid">{r.data?.data.map(p=><article className="form-card" key={p.variantId||p.id}><h2>{p.name}</h2><p>{p.size} · {money(p.priceMinor,p.currency)} · Stock: {p.stock}</p>{p.variantId&&<form className="module-form" onSubmit={e=>{e.preventDefault();request('/staff/inventory/'+p.variantId+'/adjust',{delta:Number(new FormData(e.currentTarget).get('delta'))});}}><label>Stock adjustment (+received / −removed)<input name="delta" type="number" min="-100000" max="100000" step="1" required/></label><button disabled={busy}>Apply adjustment</button></form>}</article>)}</div>
 <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Inventory"/><h2>Paid orders ready for collection</h2><ListSearch list={collection} label="Search paid orders or customers"/>{orders.error&&<p role="alert">{orders.error}</p>}{orders.data?.data.map(o=><article className="form-card" key={o.id}><h3>{o.userName}</h3><p>{o.id} · {money(o.totalMinor,o.currency)}</p><button className="button" disabled={busy} onClick={()=>request('/staff/orders/'+o.id+'/fulfill',{})}>Mark collected</button></article>)}{orders.data?.data.length===0&&<p>No paid orders awaiting collection.</p>}
 <Pagination list={collection} pagination={orders.data?.pagination} loading={orders.loading} label="Collection orders"/></ModulePanel>;
}
