import {site} from '../../config/site.js';
import {Link,useSearchParams} from 'react-router-dom';
import {useListState} from '../../hooks/useListState.js';
import {useResource} from '../../hooks/useResource.js';
import {ListSearch,Pagination,EmptyList} from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
import {money} from '../../utils/format.js';
import {getProductImage} from '../../utils/productImages.js';

// @edit:MERCHANDISE_LAYOUT @edit:PRODUCT_CARD
export default function ShopPage(){
 const list=useListState(),[params,setParams]=useSearchParams(),category=params.get('category')||'';
 const r=useResource('/browse/products?'+list.query+'&category='+encodeURIComponent(category));
 return <ModulePanel title="Wear your club spirit." description="Club essentials, made for the moments you share." resource={r}>
 <ListSearch list={list} label="Search merchandise"><Link className="button button-secondary" to="/cart">View cart</Link></ListSearch>
 <div className="filter-chips" aria-label="Product categories">{[['','All products'],['apparel','Apparel'],['accessories','Accessories'],['collectibles','Collectibles'],['exclusive','Exclusive']].map(([value,label])=><button key={value} aria-pressed={category===value} onClick={()=>setParams(prev=>{const p=new URLSearchParams(prev);p.set('category',value);p.set('page','1');return p;})}>{label}</button>)}</div>
 <div className="product-grid">{!r.loading&&r.data?.data.map((p,index)=>{
 const variants=p.variants||[],stock=variants.some(v=>v.stockQuantity>0),price=variants.length?Math.min(...variants.map(v=>v.priceMinor)):0;
 const img=getProductImage(p);
 return <Link className="product-card" to={'/shop/'+p.id} key={p.id}>
   <div className={'product-art' + (img ? ' has-image' : ' art-' + (index % 3))} aria-hidden="true">
     {img ? (
       <img src={img} alt={p.name} className="product-card-img" loading="lazy" />
     ) : (
       <>
         <span>{p.category==='apparel'?'S':'↗'}</span>
         <small>{site.name.toUpperCase()} / CLUB EDITION</small>
       </>
     )}
   </div>
   <div className="product-body">
     <div className="product-meta">
       <span>{p.category}</span>
       <span className="status-pill">{stock?'In stock':'Sold out'}</span>
     </div>
     <h2>{p.name}</h2>
     <p>{p.description}</p>
     <div className="product-bottom">
       <strong>From {money(price,variants[0]?.currency||'INR')}</strong>
       <span>Choose a size ↗</span>
     </div>
   </div>
 </Link>;
 })}</div>
 {!r.loading&&r.data?.data.length===0&&<EmptyList title="No products found" message="Try another search or category."/>}
 <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Products"/>
 </ModulePanel>;
}
