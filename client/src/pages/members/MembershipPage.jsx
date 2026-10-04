import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { money, date } from '../../utils/format.js';
import { triggerRazorpayPayment } from '../../utils/razorpay.js';

function formatMemberRef(id) {
  if (!id) return 'SKY-0001';
  if (typeof id === 'string' && id.startsWith('10000000-0000-0000-0000-')) {
    const num = id.split('-').pop().replace(/^0+/, '') || '1';
    return `SKY-${num.padStart(4, '0')}`;
  }
  return typeof id === 'string' ? `SKY-${id.slice(0, 6).toUpperCase()}` : id;
}

// @edit:MEMBERSHIP_PROFILE — modern digital wallet pass and perks dashboard
export default function MembershipPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [plans, setPlans] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

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
      <div className="account-header-bar">
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>YOUR SKYLINE MEMBERSHIP</p>
          <h1>Hello, {user.name.split(' ')[0]}.</h1>
          <p className="muted" style={{ margin: 0, fontSize: '1.05rem' }}>
            Your official club pass, exclusive discounts & privileges.
          </p>
        </div>
      </div>

      {error && (
        <div className="form-error" role="alert">
          {error} <button className="text-button" onClick={load}>Retry</button>
        </div>
      )}
      {notice && <p className="notice" role="status">{notice}</p>}
      {!profile && !error && <p role="status">Loading your membership details…</p>}

      {profile && (
        <div className="account-grid">
          {/* Digital Membership Wallet Pass */}
          <article className="member-pass" aria-label="Digital Membership Card">
            <div className="pass-top">
              <div className="pass-brand-badge">
                <div className="pass-brand-icon" aria-hidden="true">🏛️</div>
                <div>
                  <span className="pass-brand-text">Skyline Student Club</span>
                </div>
              </div>
              <span className={`pass-status-pill ${profile.membershipStatus}`}>
                <span className="pass-pulse-dot" />
                {profile.membershipStatus === 'none' ? 'Not Enrolled' : `${profile.membershipStatus} Member`}
              </span>
            </div>

            <div className="pass-chip-row">
              <div className="pass-chip" aria-hidden="true" />
              <span className="pass-nfc" aria-hidden="true">📶</span>
            </div>

            <div className="pass-member-info">
              <h2 className="pass-member-name">{profile.name}</h2>
              <p className="pass-member-email">{profile.email}</p>
            </div>

            <div className="pass-meta-grid">
              <div className="pass-meta-item">
                <dt>Plan Tier</dt>
                <dd>{profile.planName || 'Standard Membership'}</dd>
              </div>
              <div className="pass-meta-item">
                <dt>Valid Until</dt>
                <dd>{profile.expiresAt ? date(profile.expiresAt) : 'Inactive'}</dd>
              </div>
            </div>

            <div className="pass-barcode-row">
              <div className="pass-barcode-sim" aria-hidden="true">
                |||| | ||| || ||||| | ||
              </div>
              <button
                type="button"
                className="pass-ref-badge"
                title={`Click to copy full ID: ${profile.id}`}
                onClick={() => {
                  navigator.clipboard?.writeText(profile.id);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                <span>{formatMemberRef(profile.id)}</span>
                <span style={{ opacity: 0.75 }}>{copied ? '✓ Copied' : '📋'}</span>
              </button>
            </div>
          </article>

          {/* Membership Benefits Dashboard */}
          <article className="form-card benefits-card">
            <div className="benefits-header">
              <h2>✨ Member Privileges</h2>
              <button type="button" className="refresh-btn" onClick={load} title="Refresh membership status">
                <span>⟳</span> Refresh
              </button>
            </div>

            <div className={`benefits-status-banner ${profile.benefits.eligible ? 'active' : 'inactive'}`}>
              <span style={{ fontSize: '1.2rem' }}>{profile.benefits.eligible ? '🎉' : '⏳'}</span>
              <span>
                {profile.benefits.eligible
                  ? 'Your membership is active! All exclusive discounts are unlocked.'
                  : 'Benefits activate once your membership is current and dues are paid.'}
              </span>
            </div>

            <div className="perks-tiles-grid">
              <div className="perk-tile">
                <div className="perk-tile-top">
                  <div className="perk-icon-wrap events" aria-hidden="true">🎟️</div>
                  <span className="perk-pct-badge">{profile.benefits.ticketDiscountPct}%</span>
                </div>
                <div>
                  <h3 className="perk-tile-label">Event Tickets</h3>
                  <p className="perk-tile-desc">
                    Automatic {profile.benefits.ticketDiscountPct}% discount applied at checkout on all campus events & workshops.
                  </p>
                </div>
                <Link to="/events" className="perk-action-link">
                  Browse Events <span>→</span>
                </Link>
              </div>

              <div className="perk-tile">
                <div className="perk-tile-top">
                  <div className="perk-icon-wrap merch" aria-hidden="true">🛍️</div>
                  <span className="perk-pct-badge">{profile.benefits.merchDiscountPct}%</span>
                </div>
                <div>
                  <h3 className="perk-tile-label">Club Store Merch</h3>
                  <p className="perk-tile-desc">
                    Special member pricing on all hoodies, t-shirts, caps, tumblers & gear.
                  </p>
                </div>
                <Link to="/shop" className="perk-action-link">
                  Visit Store <span>→</span>
                </Link>
              </div>
            </div>

            <div className="extra-privileges-box">
              <h4 className="extra-privileges-title">Included Member Perks</h4>
              <div className="privilege-item">
                <span className="privilege-check">✓</span>
                <span>Fast-track check-in desk at all major organization gatherings</span>
              </div>
              <div className="privilege-item">
                <span className="privilege-check">✓</span>
                <span>Annual General Meeting voting rights & official club discussions</span>
              </div>
              <div className="privilege-item">
                <span className="privilege-check">✓</span>
                <span>Early access to limited-edition merchandise drops</span>
              </div>
            </div>

            {profile.duesStatus === 'pending' ? (
              <div className="dues-settlement-card pending">
                <div className="dues-card-header">
                  <span className="dues-card-amount">
                    Dues: {money(profile.duesAmountMinor, profile.currency)}
                  </span>
                  <span className="pass-status-pill pending">Pending</span>
                </div>
                <p style={{ margin: '0 0 0.8rem', fontSize: '0.85rem', color: '#92400e' }}>
                  Pay online instantly via UPI / Razorpay or pay club staff in cash at the campus desk.
                </p>
                <button
                  type="button"
                  className="button"
                  style={{ width: '100%', background: '#0f766e', color: '#fff', fontWeight: 700, padding: '0.75rem', borderRadius: '10px', boxShadow: '0 4px 12px rgba(15, 118, 110, 0.25)' }}
                  disabled={paying}
                  onClick={() => payWithRazorpay()}
                >
                  {paying ? '⏳ Opening Razorpay…' : `⚡ Pay ${money(profile.duesAmountMinor, profile.currency)} with Razorpay / UPI`}
                </button>
              </div>
            ) : profile.duesStatus === 'paid' ? (
              <div className="dues-settlement-card paid">
                <div className="dues-card-header">
                  <span className="dues-card-amount">
                    ✓ Annual Dues: {money(profile.duesAmountMinor, profile.currency)}
                  </span>
                  <span className="pass-status-pill active">Paid & Verified</span>
                </div>
                <p className="dues-card-subtitle">
                  Your dues are settled for the active academic session. All membership benefits are unlocked!
                </p>
              </div>
            ) : null}
          </article>
        </div>
      )}

      {canEnroll && (
        <div className="plan-section">
          <div className="plan-section-header">
            <p className="eyebrow" style={{ margin: 0 }}>MEMBERSHIP ENROLLMENT</p>
            <h2>{profile.membershipStatus === 'expired' ? 'Renew Your Membership' : 'Select Your Membership Plan'}</h2>
            <p className="muted" style={{ margin: 0 }}>
              Academic session ends {policy?.yearEndDay}/{policy?.yearEndMonth} ({policy?.timeZone}). Benefits unlock instantly upon payment.
            </p>
          </div>

          <div className="plans-grid">
            {plans.map((plan, idx) => (
              <article className={`plan-card-pro ${idx === 0 ? 'featured' : ''}`} key={plan.id}>
                {idx === 0 && <span className="plan-badge-top">Most Popular</span>}
                <div>
                  <h3>{plan.name}</h3>
                  <p className="muted" style={{ fontSize: '0.9rem', minHeight: '40px' }}>{plan.description}</p>
                  <div className="plan-pro-price">
                    {money(plan.duesAmountMinor, plan.currency)}
                    <span className="plan-pro-period">/ session</span>
                  </div>

                  <ul className="plan-features-list">
                    <li className="plan-feature-li">
                      <span style={{ color: '#10b981', fontWeight: 800 }}>✓</span>
                      <span><strong>{plan.ticketDiscountPct}% OFF</strong> on all club events & workshops</span>
                    </li>
                    <li className="plan-feature-li">
                      <span style={{ color: '#10b981', fontWeight: 800 }}>✓</span>
                      <span><strong>{plan.merchDiscountPct}% OFF</strong> on official merchandise store</span>
                    </li>
                    <li className="plan-feature-li">
                      <span style={{ color: '#10b981', fontWeight: 800 }}>✓</span>
                      <span>Digital membership wallet pass & barcode ID</span>
                    </li>
                    <li className="plan-feature-li">
                      <span style={{ color: '#10b981', fontWeight: 800 }}>✓</span>
                      <span>Annual General Meeting voting rights</span>
                    </li>
                  </ul>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <button
                    type="button"
                    className="button"
                    style={{ background: '#0f766e', color: '#fff', fontWeight: 700, padding: '0.75rem', borderRadius: '10px', boxShadow: '0 4px 12px rgba(15, 118, 110, 0.25)' }}
                    disabled={busy || paying}
                    onClick={() => payWithRazorpay(plan.id)}
                  >
                    {paying ? '⏳ Opening Razorpay…' : `⚡ Pay with Razorpay (${money(plan.duesAmountMinor, plan.currency)})`}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ fontSize: '0.85rem', padding: '0.65rem' }}
                    disabled={busy || paying}
                    onClick={() => enroll(plan.id)}
                  >
                    {busy ? 'Saving…' : 'Enroll Now (Pay Cash at Club Desk)'}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!plans.length && <p className="muted">No membership plans are currently open for registration.</p>}
        </div>
      )}
    </section>
  );
}

