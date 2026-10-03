import {useSearchParams,Link} from 'react-router-dom';
import {useListState} from '../hooks/useListState.js';
import {useResource} from '../hooks/useResource.js';
import {ListSearch,Pagination,EmptyList} from '../components/ListControls.jsx';
import ModulePanel from '../components/ModulePanel.jsx';
import {useAuth} from '../context/AuthContext.jsx';
// @edit:GLOBAL_SEARCH_PAGE
export default function SearchPage(){
 const list=useListState(),[params,setParams]=useSearchParams(),kind=params.get('kind')||'',{user}=useAuth();
 const r=useResource('/search?'+list.query+'&category='+encodeURIComponent(kind));
 const kinds=[['','Everything'],['events','Events'],['products','Shop'],['announcements','News'],...(user?[['orders','My orders'],['tasks','Tasks'],['expenses','Expenses']]:[]),...(user?.roles.includes('organizer')?[['members','Members']]:[])];
 return <ModulePanel title="Find your next connection." description="Search club activities, merchandise and the records you have access to." resource={r}>
 <ListSearch list={list} label="Search Skyline"/>
 <div className="filter-chips" aria-label="Search categories">{kinds.map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>setParams(prev=>{const p=new URLSearchParams(prev);p.set('kind',value);p.set('page','1');return p;})}>{label}</button>)}</div>
 <p className="search-context">{list.q?'Results for “'+list.q+'”':'Explore the latest across your club'}</p>
 <div className="search-results">{!r.loading&&r.data?.data.map(item=><Link className="search-result" to={item.href} key={item.kind+item.id}><span className="result-kind">{item.kind}</span><div><h2>{item.title}</h2><p>{item.summary}</p></div><span aria-hidden="true">↗</span></Link>)}</div>
 {!r.loading&&r.data?.data.length===0&&<EmptyList/>}
 <Pagination list={list} pagination={r.data?.pagination} loading={r.loading}/></ModulePanel>;
}
