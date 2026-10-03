import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';

// @edit:MEMBER_DIRECTORY — organizer-only UI; API authorization is in member.routes.js.
export default function MemberDirectory(){
  const [page,setPage]=useState(1),[result,setResult]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setError('');setResult(null);
    api(`/members?page=${page}&pageSize=20`,{signal:controller.signal}).then(setResult).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>controller.abort();
  },[page,retry]);
  return <section className="container account-page"><p className="eyebrow">ORGANIZER WORKSPACE</p><h1>Member directory</h1><p className="muted">Account profiles and current membership status from PostgreSQL.</p>
    {error&&<div role="alert" className="form-error">{error} <button className="text-button" onClick={()=>setRetry(retry+1)}>Retry</button></div>}
    {!result&&!error&&<p role="status">Loading members…</p>}
    {result&&<><div className="table-scroll"><table><caption>{result.pagination.total} account profiles</caption><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Membership</th></tr></thead><tbody>{result.data.map(member=><tr key={member.id}><td>{member.name}</td><td>{member.email}</td><td><span className="status-pill">{member.membershipStatus}</span></td></tr>)}</tbody></table></div>{!result.data.length&&<p>No members on this page.</p>}<div className="pagination"><button className="button button-secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page}</span><button className="button button-secondary" disabled={page*20>=result.pagination.total} onClick={()=>setPage(page+1)}>Next</button></div></>}
  </section>;
}
