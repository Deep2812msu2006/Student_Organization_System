import {site} from '../config/site.js';
export default function ModulePanel({title,description,resource,children}){
 return <section className="container account-page module-page"><p className="eyebrow">{site.name.toUpperCase()} COMMUNITY</p><h1>{title}</h1><p className="muted">{description}</p>
 {resource?.error&&<p role="alert" className="form-error">{resource.error} <button onClick={resource.reload}>Retry</button></p>}
 {resource?.loading&&<p role="status">Loading…</p>}{children}</section>;
}
