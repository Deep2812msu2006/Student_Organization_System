import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { navigation } from '../config/navigation.js';
import { site } from '../config/site.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import './Navbar.css';

export default function Navbar() {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const {user,logout}=useAuth();
  const {itemCount}=useCart();
  const toggle=useRef(null);const navigate=useNavigate();
  const staffLinks = user ? navigation.staff.filter(x => {
    if (x.planned) return false;
    if (x.href === '/staff/payments') return user.roles.includes('organizer') || user.roles.includes('treasurer');
    return user.roles.includes('organizer');
  }) : [];
  const links = user ? [...navigation.member.filter(x => !x.planned), ...staffLinks] : navigation.public;
  async function signOut(){setBusy(true);setError('');try{await logout();setOpen(false);navigate('/login');}catch(e){setError(e.message);}finally{setBusy(false);}}
  function handleKeyDown(event){if(event.key==='Escape'&&open){setOpen(false);toggle.current?.focus();}}
  return <header className="navbar" onKeyDown={handleKeyDown}><div className="container navbar-inner">
    <Link className="brand" to="/" aria-label={`${site.name} home`} onClick={()=>setOpen(false)}><img src={site.logo} alt="" width="38" height="38"/><span><strong>{site.name}</strong><small>{site.organization}</small></span></Link>
    <button className="menu-toggle" ref={toggle} type="button" aria-expanded={open} aria-controls="primary-navigation" onClick={()=>setOpen(!open)}>Menu {open?'−':'+'}</button>
    <nav id="primary-navigation" className={`nav-links ${open?'is-open':''}`} aria-label="Main navigation">
      {links.map(item=><Link key={item.href} to={item.href} onClick={()=>setOpen(false)}>{item.label}</Link>)}
      <Link to="/cart" onClick={()=>setOpen(false)}>Cart{itemCount>0&&<span className="cart-badge">{itemCount}</span>}</Link>
      {user?<button className="button button-secondary" disabled={busy} onClick={signOut}>{busy?'Signing out…':'Sign out'}</button>:<><Link to="/login" onClick={()=>setOpen(false)}>Sign in</Link><Link className="button" to="/register" onClick={()=>setOpen(false)}>Join Skyline</Link></>}
    </nav>
  </div>{error&&<p className="container form-error" role="alert">{error}</p>}</header>;
}
