import {useListState} from '../../hooks/useListState.js';
import {useResource} from '../../hooks/useResource.js';
import {ListSearch,Pagination,EmptyList} from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
// @edit:MEMBER_DIRECTORY
export default function MemberDirectory(){
 const list=useListState(),r=useResource('/browse/members?'+list.query);
 return <ModulePanel title="Member directory" description="Find people in your association and check their membership status." resource={r}>
 <ListSearch list={list} label="Search member name or email"/>
 <div className="table-scroll"><table><caption>Association members</caption><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Membership</th></tr></thead><tbody>{!r.loading&&r.data?.data.map(u=><tr key={u.id}><td><strong>{u.name}</strong></td><td>{u.email}</td><td><span className="status-pill">{u.membershipStatus}</span></td></tr>)}</tbody></table></div>
 {!r.loading&&r.data?.data.length===0&&<EmptyList/>}
 <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Members"/>
 </ModulePanel>;
}
