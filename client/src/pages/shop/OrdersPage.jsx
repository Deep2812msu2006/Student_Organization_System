import {Link} from 'react-router-dom';
import {useListState} from '../../hooks/useListState.js';
import {useResource} from '../../hooks/useResource.js';
import {ListSearch,Pagination,EmptyList} from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
import {money,date} from '../../utils/format.js';
// @edit:ORDER_STATUS
export default function OrdersPage(){
 const list=useListState(),r=useResource('/browse/orders?'+list.query);
 return <ModulePanel title="My Merchandise Orders" description="Your club purchases, payment status and collection details." resource={r}>
 <ListSearch list={list} label="Search order number, product or status"/>
 <div className="orders-list">{!r.loading&&r.data?.data.map(o=><Link className="order-card" key={o.id} to={'/orders/'+o.id}><div className="order-header-row"><div><strong>Order #{o.id.slice(0,8)}</strong><p className="muted">{date(o.createdAt)}</p></div><span className={'status-badge '+o.status}>{o.status==='pending'?'Awaiting payment':o.status}</span></div><p>{o.items.map(i=>i.quantity+' × '+i.productName+' ('+i.variantName+')').join(', ')}</p><div className="product-bottom"><strong>{money(o.totalMinor,o.currency)}</strong><span>View order ↗</span></div></Link>)}</div>
 {!r.loading&&r.data?.data.length===0&&<EmptyList title={list.q?'No matching orders':'No orders yet'} message="Browse the shop to find your club essentials."/>}
 <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Orders"/>
 </ModulePanel>;
}
