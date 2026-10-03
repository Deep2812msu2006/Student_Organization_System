import { Link } from 'react-router-dom';
import ConnectionStatus from '../components/ConnectionStatus.jsx';
import { plannedModules, site } from '../config/site.js';

export default function HomePage() {
  return <div className="container">
    <section className="hero" id="overview" aria-labelledby="hero-title">
      <div><p className="eyebrow">{site.eyebrow}</p><h1 id="hero-title">{site.headline}</h1><p className="intro muted">{site.description}</p>
        <div className="hero-actions"><Link className="button" to="/register">Join the association <span aria-hidden="true">&nbsp;↗</span></Link><a className="button button-secondary" href="#team">Meet the build team</a></div>
        <p className="foundation-note muted">Membership and event reservations are available. Payment recording and shop checkout are coming next.</p>
      </div>
      <ConnectionStatus />
    </section>
    <section className="modules" id="modules" aria-labelledby="modules-title">
      <div className="section-heading"><div><p className="eyebrow">ONE HOME FOR YOUR ASSOCIATION</p><h2 id="modules-title">What we’re building next</h2></div><p className="muted">Six connected workflows. One shared foundation.</p></div>
      <div className="module-grid">{plannedModules.map(module => <article className="module-card" key={module.number}>
        <div className="module-top"><span className="module-number">{module.number}</span><span className="badge">{['01','02'].includes(module.number) ? 'Available' : 'Planned'}</span></div>
        <h3>{module.title}</h3><p>{module.description}</p><div className="module-owner">Build team · {module.owner}</div>
      </article>)}</div>
    </section>
    <section className="team-section" id="team" aria-labelledby="team-title">
      <div className="section-heading"><div><p className="eyebrow">BUILDING TOGETHER</p><h2 id="team-title">Clear ownership. Shared progress.</h2></div></div>
      <div className="team-grid"><div><h3>Om</h3><p>Frontend, authentication, memberships, event registration and order APIs.</p></div><div><h3>Deep</h3><p>PostgreSQL schema, SQL models, migrations, transactions and reporting queries.</p></div><div><h3>Dharmik</h3><p>Check-in, expenses, announcements, reminders, tasks, testing and delivery.</p></div></div>
    </section>
  </div>;
}
