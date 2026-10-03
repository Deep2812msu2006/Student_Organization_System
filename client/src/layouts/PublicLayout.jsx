import Navbar from '../components/Navbar.jsx';
import { site } from '../config/site.js';

export default function PublicLayout({ children }) {
  return <>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <Navbar />
    <main id="main-content" tabIndex={-1}>{children}</main>
    <footer className="footer"><div className="container"><span>{site.name} · {site.organization}</span><span>Membership preview · Events and payments coming next</span></div></footer>
  </>;
}
