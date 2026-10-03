import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { money,date } from '../../utils/format.js';

// @edit:MEMBERSHIP_PROFILE — display only; paid/expiry eligibility is calculated by the server.
export default function MembershipPage(){
  const {user}=useAuth();
  const [profile,setProfile]=useState(null);
  const [plans,setPlans]=useState([]);
  const [policy,setPolicy]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  async function load(){
    setError('');
    try {const [member,options]=await Promise.all([api('/members/me'),api('/membership-plans')]);setProfile(member.data);setPlans(options.data);setPolicy(options.policy);}
    catch(e){setError(e.message);}
  }
  useEffect(()=>{load();},[]);
  async function enroll(planId){
    setBusy(true);setError('');setNotice('');
    try{await api('/memberships',{method:'POST',body:{planId}});setNotice('Your membership enrollment is saved. Dues are pending; no payment has been processed.');await load();}
    catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  const canEnroll=profile && ['none','expired'].includes(profile.membershipStatus);
  return <section className="container account-page">
    <p className="eyebrow">YOUR SKYLINE ACCOUNT</p><h1>Hello, {user.name.split(' ')[0]}.</h1><p className="muted">Your membership and benefits, all in one place.</p>
    {error&&<div className="form-error" role="alert">{error} <button className="text-button" onClick={load}>Retry</button></div>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    {!profile&&!error&&<p role="status">Loading your membership…</p>}
    {profile&&<div className="account-grid">
      <article className="member-pass"><div className="pass-top"><span className="eyebrow">SKYLINE MEMBER PROFILE</span><span className="status-pill">{profile.membershipStatus==='none'?'Not enrolled':profile.membershipStatus}</span></div><h2>{profile.name}</h2><p>{profile.email}</p><dl><div><dt>Plan</dt><dd>{profile.planName||'Choose your membership'}</dd></div><div><dt>Valid until (exclusive)</dt><dd>{date(profile.expiresAt)}</dd></div><div><dt>Member reference</dt><dd className="reference">{profile.id}</dd></div></dl></article>
      <article className="form-card benefits"><h2>Membership benefits</h2><p className="muted">{profile.benefits.eligible?'Your paid membership is currently active.':'Benefits activate only while your membership is current and dues are paid.'}</p><div className="benefit-row"><span>Event ticket discount</span><strong>{profile.benefits.ticketDiscountPct}%</strong></div><div className="benefit-row"><span>Merchandise discount</span><strong>{profile.benefits.merchDiscountPct}%</strong></div>{profile.duesStatus&&<div className="dues-note"><strong>Dues: {money(profile.duesAmountMinor,profile.currency)}</strong><span className="status-pill">{profile.duesStatus}</span></div>}<small className="muted">Event bookings, shop checkout and payment recording are upcoming modules.</small></article>
    </div>}
    {canEnroll&&<div className="plan-section"><h2>{profile.membershipStatus==='expired'?'Renew your membership':'Choose a membership'}</h2><p className="muted">Provisional demo policy: association year ends {policy?.yearEndDay}/{policy?.yearEndMonth} ({policy?.timeZone}). Enrollment records dues; it does not charge you.</p><div className="plans-grid">{plans.map(plan=><article className="form-card" key={plan.id}><h3>{plan.name}</h3><p className="plan-price">{money(plan.duesAmountMinor,plan.currency)}</p><p className="muted">{plan.description}</p><p>{plan.ticketDiscountPct}% ticket discount · {plan.merchDiscountPct}% shop discount when active</p><button className="button" disabled={busy} onClick={()=>enroll(plan.id)}>{busy?'Saving…':'Enroll in membership'}</button></article>)}</div>{!plans.length&&<p>No membership plans are available yet. Please contact an organizer.</p>}</div>}
  </section>;
}
