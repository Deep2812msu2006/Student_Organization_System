import {Link,useNavigate} from 'react-router-dom';
import {site} from '../config/site.js';
import {useAuth} from '../context/AuthContext.jsx';
// @edit:HOME_HERO — branding/copy in config/site.js; decorative shapes contain no fake data.
export default function HomePage(){
 const navigate=useNavigate(),{user}=useAuth();
 return <div className="container home-page"><section className="home-hero">
 <div className="home-hero-copy"><p className="eyebrow"><span className="live-dot"/> YOUR CAMPUS. YOUR COMMUNITY.</p><h1>Good things happen<br/>when we <em>come together.</em></h1><p className="hero-description">Find your people, make something happen, and keep club life in one place. Welcome to {site.name}.</p>
 <form className="hero-search" role="search" aria-label="Find something in your club" onSubmit={e=>{e.preventDefault();navigate('/search?q='+encodeURIComponent(new FormData(e.currentTarget).get('q')));}}><label className="sr-only" htmlFor="home-search">Search your club</label><span aria-hidden="true">⌕</span><input id="home-search" name="q" maxLength="120" placeholder="Events, merchandise, announcements…"/><button className="button" type="submit">Explore ↗</button></form>
 <div className="hero-links"><Link to="/events">Find an event ↗</Link><Link to={user?'/membership':'/register'}>{user?'My membership':'Become a member'} ↗</Link></div></div>
 <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="art-label">A LITTLE MORE CONNECTED.</span><div className="hero-pass"><span>{site.name.toUpperCase()}</span><strong>Your people.<br/>Your place.</strong><div className="pass-mark">↗</div><small>STUDENT ASSOCIATION / MEMBERSHIP</small></div><div className="floating-note"><span>✦</span> Ideas grow here.</div></div>
 </section>
 <section className="home-invitation"><div><p className="eyebrow">YOU BRING THE ENERGY</p><h2>There’s a place for you here.</h2><p>Join a task, share an idea, or simply show up.</p></div><Link className="button" to={user?'/tasks':'/register'}>{user?'Explore my tasks':'Join the community'} ↗</Link></section>
 </div>;
}
