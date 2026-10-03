import {useEffect,useId,useState} from 'react';
import {useClampPage} from '../hooks/useListState.js';
// @edit:SEARCH_BAR — shared list search, accessible labels, and explicit submission.
export function ListSearch({list,label='Search this list',children}){
 const [draft,setDraft]=useState(list.q),id=useId();
 useEffect(()=>setDraft(list.q),[list.q]);
 return <div className="list-toolbar"><form role="search" aria-label={label} className="list-search" onSubmit={e=>{e.preventDefault();list.search(draft);}}>
 <label className="sr-only" htmlFor={id}>{label}</label><span aria-hidden="true" className="search-icon">⌕</span>
 <input id={id} type="search" maxLength={120} value={draft} placeholder={label} onChange={e=>setDraft(e.target.value)}/>
 <button type="submit" className="button">Search</button>{list.q&&<button className="text-button" type="button" onClick={()=>{setDraft('');list.search('');}}>Clear</button>}</form>{children}</div>;
}
// @edit:PAGINATION — page sizes, counts and a bounded page-number strip.
export function Pagination({list,pagination,loading=false,label='Results'}){
 useClampPage(list,pagination,loading);
 const total=pagination?.total||0,pages=Math.max(1,Math.ceil(total/list.pageSize)),start=total?(list.page-1)*list.pageSize+1:0;
 const numbers=[...new Set([1,...Array.from({length:5},(_,i)=>list.page+i-2).filter(n=>n>1&&n<pages),pages])].sort((a,b)=>a-b);
 return <nav className="list-pagination" aria-label={label+' pages'}><p aria-live="polite">{loading?'Loading…':total?start+'–'+Math.min(list.page*list.pageSize,total)+' of '+total+' results':'0 results'}</p>
 <div className="page-buttons"><button disabled={loading||list.page===1} onClick={()=>list.setPage(list.page-1)} aria-label="Previous page">←</button>
 {numbers.map((n,i)=><span key={n}>{i>0&&n-numbers[i-1]>1&&<span className="page-gap">…</span>}<button aria-label={'Page '+n} aria-current={list.page===n?'page':undefined} disabled={loading} onClick={()=>list.setPage(n)}>{n}</button></span>)}
 <button disabled={loading||list.page>=pages} onClick={()=>list.setPage(list.page+1)} aria-label="Next page">→</button></div>
 <label>Per page <select aria-label={label+' per page'} value={list.pageSize} onChange={e=>list.setPageSize(Number(e.target.value))}>{[12,24,48].map(n=><option key={n}>{n}</option>)}</select></label></nav>;
}
export function EmptyList({title='No matching results',message='Try another search or clear your filters.'}){
 return <div className="empty-list"><span aria-hidden="true">⌕</span><h2>{title}</h2><p>{message}</p></div>;
}
