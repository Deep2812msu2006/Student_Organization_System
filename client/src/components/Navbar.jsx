import { useRef, useState } from 'react';
import { navigation } from '../config/navigation.js';
import { site } from '../config/site.js';
import './Navbar.css';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  function handleKeyDown(event) {
    if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); }
  }
  return <header className="navbar" onKeyDown={handleKeyDown}>
    <div className="container navbar-inner">
      <a className="brand" href="#overview" aria-label={`${site.name} home`} onClick={() => setOpen(false)}>
        <img src={site.logo} alt="" width="38" height="38" />
        <span><strong>{site.name}</strong><small>{site.organization}</small></span>
      </a>
      <button className="menu-toggle" ref={toggle} type="button" aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen(!open)}>Menu {open ? '−' : '+'}</button>
      <nav id="primary-navigation" className={`nav-links ${open ? 'is-open' : ''}`} aria-label="Main navigation">
        {navigation.public.map(item => <a key={item.href} href={item.href} onClick={() => setOpen(false)}>{item.label}</a>)}
        <span className="foundation-label">Foundation preview</span>
      </nav>
    </div>
  </header>;
}
