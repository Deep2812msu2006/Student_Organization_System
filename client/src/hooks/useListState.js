import {useEffect} from 'react';
import {useSearchParams} from 'react-router-dom';
// @flow:LIST_NAVIGATION — search, page and page size are bookmarkable and browser-back friendly.
export function useListState(prefix=''){
 const [params,setParams]=useSearchParams();
 const name=k=>prefix?prefix+'_'+k:k;
 const rawPage=Number(params.get(name('page'))||1),rawSize=Number(params.get(name('pageSize'))||12);
 const page=Number.isInteger(rawPage)&&rawPage>0?Math.min(rawPage,100000):1;
 const pageSize=[12,24,48].includes(rawSize)?rawSize:12;
 const q=(params.get(name('q'))||'').slice(0,120);
 function update(values){setParams(prev=>{const next=new URLSearchParams(prev);for(const[k,v]of Object.entries(values)){if(v===''||v===null)next.delete(name(k));else next.set(name(k),String(v));}return next;});}
 return {q,page,pageSize,search:q=>update({q:q.trim(),page:1}),setPage:page=>update({page}),setPageSize:pageSize=>update({pageSize,page:1}),
 query:new URLSearchParams({q,page:String(page),pageSize:String(pageSize)}).toString()};
}
export function useClampPage(list,pagination,loading){
 const last=Math.max(1,Math.ceil((pagination?.total||0)/list.pageSize));
 useEffect(()=>{if(pagination&&!loading&&list.page>last)list.setPage(last);},[list.page,last,loading,pagination?.total]);
}
