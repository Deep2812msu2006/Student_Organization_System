import {useRef,useState} from 'react';
import {Link,NavLink,useNavigate} from 'react-router-dom';
import {navigation} from '../config/navigation.js';
import {site} from '../config/site.js';
import {useAuth} from '../context/AuthContext.jsx';
import {useCart} from '../context/CartContext.jsx';
import './Navbar.css';
// @edit:NAVBAR_LINKS — primary links and role-filtered workspace menus.
export default function Navbar(){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const {user,logout}=useAuth(),{itemCount}=useCart(),toggle=useRef(null),header=useRef(null),navigate=useNavigate();
 function close(){setOpen(false);header.current?.querySelectorAll('details[open]').forEach(d=>d.open=false);}
 function menu(title,links){return <details className="nav-dropdown"><summary>{title}<span aria-hidden="true">⌄</span></summary><div className="nav-dropdown-panel">{links.map(x=><NavLink key={x.href} to={x.href} onClick={close}>{x.label}</NavLink>)}</div></details>;}
 async function signOut(){setBusy(true);setError('');try{await logout();close();navigate('/login');}catch(e){setError(e.message);}finally{setBusy(false);}}
 const staffLinks=user?navigation.staff.filter(x=>x.roles.some(r=>user.roles.includes(r))):[];
 return <header className="navbar" ref={header} onKeyDown={e=>{if(e.key==='Escape'){close();toggle.current?.focus();}}}><div className="container navbar-inner">
 <Link className="brand" to="/" onClick={close} aria-label={site.name+' home'}><img src={site.logo} alt="" width="38" height="38"/><span><strong>{site.name}</strong><small>{site.organization}</small></span></Link>
 <button className="menu-toggle" ref={toggle} type="button" aria-expanded={open} aria-controls="primary-navigation" onClick={()=>setOpen(!open)}>Menu {open?'−':'+'}</button>
 <nav id="primary-navigation" className={'nav-links '+(open?'is-open':'')} aria-label="Main navigation">
 {(user?navigation.member.filter(x=>x.group==="primary"):navigation.public).map(item=><NavLink key={item.href} to={item.href} onClick={close}>{item.label}</NavLink>)}
 {user?menu('Community',navigation.member.filter(x=>x.group==='community')):null}
 {user&&menu('My account',navigation.member.filter(x=>x.group==='account'))}
 {staffLinks.length>0&&menu('Workspace',staffLinks)}
 {navigation.utility.map(item=><NavLink key={item.href} className={item.icon?"nav-search-link":undefined} to={item.href} onClick={close}>{item.icon&&<span aria-hidden="true">{item.icon}</span>}{item.label}{item.cart&&itemCount>0&&<span className="cart-badge">{itemCount}</span>}</NavLink>)}
 {user?<button className="button button-secondary" disabled={busy} onClick={signOut}>{busy?'Signing out…':'Sign out'}</button>:<><NavLink to="/login" onClick={close}>Sign in</NavLink><Link className="button" to="/register" onClick={close}>Join Skyline ↗</Link></>}
 </nav></div>{error&&<p role="alert" className="container form-error">{error}</p>}</header>;
}
