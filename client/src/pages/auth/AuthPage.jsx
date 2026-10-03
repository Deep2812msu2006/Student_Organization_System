import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

// @edit:MEMBERSHIP_FORM — signup/login fields; authoritative validation is server/validators/auth.schema.js.
export default function AuthPage({mode}) {
  const signup=mode==='register';
  const {user,authenticate}=useAuth();
  const navigate=useNavigate();
  const [values,setValues]=useState({name:'',email:'',password:''});
  const [error,setError]=useState('');
  const [fields,setFields]=useState({});
  const [busy,setBusy]=useState(false);
  if(user) return <Navigate to="/membership" replace/>;
  async function submit(event) {
    event.preventDefault();setError('');setFields({});setBusy(true);
    try { await authenticate(mode,signup?values:{email:values.email,password:values.password});navigate('/membership',{replace:true}); }
    catch(e) {setError(e.message);setFields(e.fields||{});}
    finally {setBusy(false);}
  }
  return <section className="container auth-grid">
    <div className="auth-story"><p className="eyebrow">A PLACE TO BELONG</p><h1>{signup?'Your next chapter starts here.':'Good to have you back.'}</h1><p>Keep your membership, benefits and association updates close at hand.</p><div className="story-note"><strong>One account. Your association.</strong><p>Membership benefits become available after your dues are recorded as paid.</p></div></div>
    <div className="form-card"><p className="eyebrow">{signup?'JOIN SKYLINE':'MEMBER ACCESS'}</p><h2>{signup?'Create your account':'Sign in to Skyline'}</h2><p className="muted">{signup?'Start with your details. Choose a membership next.':'Use the email and password you registered with.'}</p>
      <form onSubmit={submit}>
        {error&&<div className="form-error" role="alert">{error}</div>}
        {(signup?['name','email','password']:['email','password']).map(field=><div className="field" key={field}>
          <label htmlFor={field}>{field==='name'?'Full name':field==='email'?'Email address':'Password'}</label>
          <input id={field} name={field} type={field==='password'?'password':field==='email'?'email':'text'} value={values[field]} onChange={e=>setValues({...values,[field]:e.target.value})} required maxLength={field==='name'?100:field==='email'?254:72} minLength={field==='password'&&signup?10:undefined} autoComplete={field==='password'?(signup?'new-password':'current-password'):field} aria-invalid={!!fields[field]} aria-describedby={fields[field]?`${field}-error`:field==='password'&&signup?'password-hint':undefined}/>
          {fields[field]&&<span id={`${field}-error`} className="field-error">{fields[field]}</span>}
          {signup&&field==='password'&&<small id="password-hint" className="muted">At least 10 characters. Use a unique password.</small>}
        </div>)}
        <button className="button full-width" disabled={busy} type="submit">{busy?'Please wait…':signup?'Create account':'Sign in'}</button>
      </form>
      <p className="form-footer">{signup?'Already part of Skyline?':'New to the association?'} <Link to={signup?'/login':'/register'}>{signup?'Sign in':'Create an account'}</Link></p>
    </div>
  </section>;
}
