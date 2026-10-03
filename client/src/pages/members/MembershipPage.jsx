import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { money, date } from '../../utils/format.js';
import { triggerRazorpayPayment } from '../../utils/razorpay.js';

// @edit:MEMBERSHIP_PROFILE — display only; paid/expiry eligibility is calculated by the server.
export default function MembershipPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [plans, setPlans] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState('');

  async function load() {
    setError('');
    try {
      const [member, options] = await Promise.all([api('/members/me'), api('/membership-plans')]);
      setProfile(member.data);
      setPlans(options.data);
      setPolicy(options.policy);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function enroll(planId) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/memberships', { method: 'POST', body: { planId } });
      setNotice('Your membership enrollment is saved. Dues are pending; you can pay with Razorpay below or pay club staff.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function payWithRazorpay(planId) {
    setPaying(true);
    setError('');
    setNotice('');
    try {
      const orderRes = await api('/memberships/razorpay/order', {
        method: 'POST',
        body: planId ? { planId } : {},
      });

      await triggerRazorpayPayment({
        orderId: orderRes.data.duesObligationId || 'membership',
        razorpayOrderId: orderRes.data.razorpayOrderId,
        amountMinor: orderRes.data.amountMinor,
        currency: orderRes.data.currency,
        keyId: orderRes.data.keyId,
        user,
        description: 'Skyline Annual Membership Dues',
        onSuccess: async (rzpPayload) => {
          try {
            const verifyRes = await api('/memberships/razorpay/verify', {
              method: 'POST',
              body: rzpPayload,
            });
            setProfile(verifyRes.data);
            setNotice('🎉 Payment verified via Razorpay! Your membership is now active with all discounts unlocked.');
            await load();
          } catch (vErr) {
            setError(vErr.message || 'Payment verification failed.');
          } finally {
            setPaying(false);
          }
        },
        onDismiss: () => {
          setPaying(false);
          load();
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to initiate Razorpay payment.');
      setPaying(false);
    }
  }

  const canEnroll = profile && ['none', 'expired'].includes(profile.membershipStatus);

  return (
    <section className="container account-page">
      <p className="eyebrow">YOUR SKYLINE ACCOUNT</p>
      <h1>Hello, {user.name.split(' ')[0]}.</h1>
      <p className="muted">Your membership and benefits, all in one place.</p>
      {error && (
        <div className="form-error" role="alert">
          {error} <button className="text-button" onClick={load}>Retry</button>
        </div>
      )}
      {notice && <p className="notice" role="status">{notice}</p>}
      {!profile && !error && <p role="status">Loading your membership…</p>}

      {profile && (
        <div className="account-grid">
          <article className="member-pass">
            <div className="pass-top">
              <span className="eyebrow">SKYLINE MEMBER PROFILE</span>
              <span className="status-pill">{profile.membershipStatus === 'none' ? 'Not enrolled' : profile.membershipStatus}</span>
            </div>
            <h2>{profile.name}</h2>
            <p>{profile.email}</p>
            <dl>
              <div>
                <dt>Plan</dt>
                <dd>{profile.planName || 'Choose your membership'}</dd>
              </div>
              <div>
                <dt>Valid until (exclusive)</dt>
                <dd>{date(profile.expiresAt)}</dd>
              </div>
              <div>
                <dt>Member reference</dt>
                <dd className="reference">{profile.id}</dd>
              </div>
            </dl>
          </article>

          <article className="form-card benefits">
            <h2>Membership benefits</h2>
            <button className="text-button" onClick={load}>Refresh status</button>
            <p className="muted">
              {profile.benefits.eligible
                ? '🎉 Your paid membership is currently active!'
                : 'Benefits activate only while your membership is current and dues are paid.'}
            </p>
            <div className="benefit-row">
              <span>Event ticket discount</span>
              <strong>{profile.benefits.ticketDiscountPct}%</strong>
            </div>
            <div className="benefit-row">
              <span>Merchandise discount</span>
              <strong>{profile.benefits.merchDiscountPct}%</strong>
            </div>

            {profile.duesStatus === 'pending' ? (
              <div style={{ marginTop: '1.2rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <strong style={{ fontSize: '1.05rem', color: '#166534' }}>
                    Dues: {money(profile.duesAmountMinor, profile.currency)}
                  </strong>
                  <span className="status-pill" style={{ background: '#fef3c7', color: '#92400e' }}>Pending</span>
                </div>
                <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 0.8rem 0' }}>
                  Pay online using Razorpay, or pay club staff at the campus desk.
                </p>
                <button
                  type="button"
                  className="button"
                  style={{ width: '100%', background: '#0f766e', color: '#fff', fontWeight: 700, boxShadow: '0 4px 12px rgba(15, 118, 110, 0.25)' }}
                  disabled={paying}
                  onClick={() => payWithRazorpay()}
                >
                  {paying ? '⏳ Opening Razorpay…' : `⚡ Pay ${money(profile.duesAmountMinor, profile.currency)} with Razorpay`}
                </button>
                <small className="muted" style={{ display: 'block', marginTop: '0.6rem', textAlign: 'center', fontSize: '0.8rem' }}>
                  Or pay cash with club staff at the campus desk.
                </small>
              </div>
            ) : profile.duesStatus ? (
              <div className="dues-note">
                <strong>Dues: {money(profile.duesAmountMinor, profile.currency)}</strong>
                <span className="status-pill" style={{ background: '#dcfce7', color: '#14532d' }}>{profile.duesStatus}</span>
              </div>
            ) : null}

            {profile.duesStatus === 'paid' && (
              <small className="muted" style={{ color: '#166534', marginTop: '0.8rem', display: 'block', fontWeight: 600 }}>
                ✓ Dues confirmed. You receive discounts on all events and shop merchandise.
              </small>
            )}
            {profile.membershipStatus === 'none' && (
              <small className="muted" style={{ marginTop: '0.8rem', display: 'block' }}>
                Choose a membership plan below. You can pay club staff after enrolling.
              </small>
            )}
          </article>
        </div>
      )}

      {canEnroll && (
        <div className="plan-section">
          <h2>{profile.membershipStatus === 'expired' ? 'Renew your membership' : 'Choose a membership'}</h2>
          <p className="muted">
            Association year ends {policy?.yearEndDay}/{policy?.yearEndMonth} ({policy?.timeZone}). Benefits activate after dues payment is confirmed.
          </p>
          <div className="plans-grid">
            {plans.map((plan) => (
              <article className="form-card" key={plan.id}>
                <h3>{plan.name}</h3>
                <p className="plan-price">{money(plan.duesAmountMinor, plan.currency)}</p>
                <p className="muted">{plan.description}</p>
                <p>
                  <strong>{plan.ticketDiscountPct}%</strong> ticket discount · <strong>{plan.merchDiscountPct}%</strong> shop discount when active
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="button"
                    style={{ background: '#0f766e', color: '#fff', fontWeight: 700, boxShadow: '0 4px 12px rgba(15, 118, 110, 0.25)' }}
                    disabled={busy || paying}
                    onClick={() => payWithRazorpay(plan.id)}
                  >
                    {paying ? '⏳ Opening Razorpay…' : `⚡ Pay with Razorpay (${money(plan.duesAmountMinor, plan.currency)})`}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ fontSize: '0.85rem' }}
                    disabled={busy || paying}
                    onClick={() => enroll(plan.id)}
                  >
                    {busy ? 'Saving…' : 'Enroll without paying now (pay cash to staff)'}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!plans.length && <p>No membership plans are available yet. Please contact an organizer.</p>}
        </div>
      )}
    </section>
  );
}
