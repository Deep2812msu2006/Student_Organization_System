import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import { money, date } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { triggerRazorpayPayment } from '../../utils/razorpay.js';

export default function OrderDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const justPlaced = searchParams.get('placed') === 'true';
  const justPaid = searchParams.get('paid') === 'true';

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payingWithUpi, setPayingWithUpi] = useState(false);
  const [paySuccessMsg, setPaySuccessMsg] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await api(`/orders/${id}`);
        if (!ignore) setOrder(res.data);
      } catch (err) {
        if (!ignore) setError(err.message || 'Unable to load order details.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [id]);

  async function handleCancel() {
    setCancelling(true);
    setError('');
    try {
      const res = await api(`/orders/${id}/cancel`, {
        method: 'POST',
        body: { reason: cancelReason || 'Customer requested cancellation' },
      });
      setOrder(res.data);
      setShowCancelPrompt(false);
      setCancelSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to cancel order.');
    } finally {
      setCancelling(false);
    }
  }

  async function handlePayWithUpi() {
    if (!order || order.status !== 'pending') return;
    setPayingWithUpi(true);
    setError('');

    try {
      const rzpRes = await api(`/orders/${order.id}/razorpay/order`, {
        method: 'POST',
      });

      await triggerRazorpayPayment({
        orderId: order.id,
        razorpayOrderId: rzpRes.data.razorpayOrderId,
        amountMinor: rzpRes.data.amountMinor,
        currency: rzpRes.data.currency,
        keyId: rzpRes.data.keyId,
        user,
        onSuccess: async (rzpPayload) => {
          try {
            const verifyRes = await api(`/orders/${order.id}/razorpay/verify`, {
              method: 'POST',
              body: rzpPayload,
            });
            setOrder(verifyRes.data);
            setPaySuccessMsg('Payment verified successfully via Razorpay UPI! Your order is now confirmed as Paid.');
          } catch (vErr) {
            setError(vErr.message || 'Payment verification failed.');
          } finally {
            setPayingWithUpi(false);
          }
        },
        onDismiss: () => {
          setPayingWithUpi(false);
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to start UPI payment.');
      setPayingWithUpi(false);
    }
  }

  if (loading) {
    return (
      <section className="container shop-page">
        <p className="muted">Loading order details…</p>
      </section>
    );
  }

  if (error || !order) {
    return (
      <section className="container shop-page">
        <p className="form-error" role="alert">{error || 'Order not found.'}</p>
        <Link className="button button-secondary" to="/orders">← Back to My Orders</Link>
      </section>
    );
  }

  function getStatusDescription(status) {
    switch (status) {
      case 'pending':
        return 'Your order has been placed and inventory is reserved. Please complete payment with association staff. Payment confirmation will update this status.';
      case 'paid':
        return 'Payment has been confirmed by staff. Your merchandise order is being prepared for pickup/delivery.';
      case 'fulfilled':
        return 'This order has been completed and delivered or collected.';
      case 'cancelled':
        return `This order was cancelled on ${date(order.cancelledAt)}. The items have been safely returned to club inventory.`;
      default:
        return '';
    }
  }

  // @rule:PENDING_ONLY_CANCEL — Customer cancellation is only allowed while order is pending.
  // Paid orders cannot be cancelled through this prototype.
  const canCancel = order.status === 'pending';

  return (
    <section className="container shop-page">
      <Link className="muted" to="/orders" style={{ display: 'inline-block', marginBottom: 'var(--space-4)' }}>
        ← Back to My Orders
      </Link>

      {justPaid && (
        <div className="status-badge paid" style={{ width: '100%', padding: 'var(--space-4)', marginBottom: 'var(--space-6)', borderRadius: '8px', background: '#dcfce7', color: '#14532d', border: '1px solid #86efac' }}>
          <strong>🎉 Direct Purchase Complete!</strong> Payment was verified via Razorpay UPI. Order confirmed as Paid directly without any admin action.
        </div>
      )}

      {paySuccessMsg && (
        <div className="status-badge paid" style={{ width: '100%', padding: 'var(--space-4)', marginBottom: 'var(--space-6)', borderRadius: '8px', background: '#dcfce7', color: '#14532d', border: '1px solid #86efac' }}>
          <strong>🎉 {paySuccessMsg}</strong>
        </div>
      )}

      {justPlaced && !justPaid && (
        <div className="status-badge pending" style={{ width: '100%', padding: 'var(--space-4)', marginBottom: 'var(--space-6)', borderRadius: '8px' }}>
          <strong>Order placed successfully!</strong> Items have been reserved in your name. You can pay with UPI directly below or pay cash at the club desk.
        </div>
      )}

      {cancelSuccess && (
        <div className="status-badge cancelled" style={{ width: '100%', padding: 'var(--space-4)', marginBottom: 'var(--space-6)', borderRadius: '8px' }}>
          <strong>Order cancelled:</strong> Your reservation was released and stock has been restored to inventory.
        </div>
      )}

      <div className="order-detail-card">
        <div className="order-header-row">
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>ORDER RECEIPT</p>
            <h2>Order #{order.id}</h2>
            <p className="muted" style={{ margin: 0, marginTop: 'var(--space-1)' }}>
              Placed on {date(order.createdAt)}
            </p>
          </div>
          {/* @edit:ORDER_STATUS — order status badge and state indicator */}
          <span className={`status-badge ${order.status}`} style={{ fontSize: '1rem', padding: 'var(--space-2) var(--space-4)' }}>
            ● {order.status.toUpperCase()}
          </span>
        </div>

        <div className="story-note" style={{ margin: 0 }}>
          <strong>Status details:</strong>
          <p style={{ margin: 0, marginTop: 'var(--space-1)' }}>{getStatusDescription(order.status)}</p>
          {order.cancellationReason && (
            <p className="muted" style={{ margin: 0, marginTop: 'var(--space-1)', fontSize: '0.85rem' }}>
              Reason: {order.cancellationReason}
            </p>
          )}
        </div>

        {/* Instant UPI Payment Box for Pending Orders */}
        {order.status === 'pending' && (
          <div style={{ padding: 'var(--space-4)', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span aria-hidden="true" style={{ fontSize: '1.2rem' }}>📱</span>
                <strong style={{ color: '#166534', fontSize: '1rem' }}>Pay Instantly with UPI</strong>
                <span style={{ fontSize: '0.72rem', background: '#16a34a', color: '#fff', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  NO ADMIN NEEDED
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#15803d' }}>
                Complete payment directly via GPay / PhonePe / Paytm test mode. Status updates to <strong>PAID</strong> immediately!
              </p>
            </div>
            <button
              type="button"
              className="button"
              style={{ background: '#0f766e', color: '#fff', fontWeight: 700, padding: 'var(--space-3) var(--space-5)', boxShadow: '0 4px 12px rgba(15, 118, 110, 0.25)' }}
              disabled={payingWithUpi}
              onClick={handlePayWithUpi}
            >
              {payingWithUpi ? '⏳ Opening Razorpay…' : `⚡ Pay ${money(order.totalMinor, order.currency)} via UPI`}
            </button>
          </div>
        )}

        {/* Itemized Snapshot Table */}
        <div>
          <h3>Items Snapshot</h3>
          <table className="cart-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Variant / Option</th>
                <th>Unit Price</th>
                <th>Qty</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {(order.items || []).map(item => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 600 }}>{item.productName}</td>
                  <td>{item.variantName}</td>
                  <td>{money(item.unitPriceMinor, order.currency)}</td>
                  <td>{item.quantity}</td>
                  <td style={{ fontWeight: 600 }}>{money(item.totalMinor, order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '2px solid var(--color-border)', paddingTop: 'var(--space-4)' }}>
          <div style={{ textAlign: 'right' }}>
            <span className="muted">Total Amount:</span>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-brand)' }}>
              {money(order.totalMinor, order.currency)}
            </div>
          </div>
        </div>

        {/* Cancellation Section */}
        {canCancel && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-6)', marginTop: 'var(--space-4)' }}>
            {!showCancelPrompt ? (
              <button
                type="button"
                className="button button-secondary"
                style={{ color: '#9b1c1c', borderColor: '#e5d1d1' }}
                onClick={() => setShowCancelPrompt(true)}
              >
                Cancel this Order
              </button>
            ) : (
              <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: '8px', padding: 'var(--space-4)' }}>
                <h4 style={{ color: '#9b1c1c', margin: 0, marginBottom: 'var(--space-2)' }}>Cancel Order Confirmation</h4>
                <p style={{ fontSize: '0.9rem', margin: 0, marginBottom: 'var(--space-3)' }}>
                  Are you sure you want to cancel this order? All reserved merchandise items will be immediately returned to club inventory.
                </p>
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <label htmlFor="cancel-reason" style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: 'var(--space-1)' }}>
                    Reason (optional):
                  </label>
                  <input
                    id="cancel-reason"
                    type="text"
                    placeholder="e.g. Ordered wrong size, changed mind"
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    style={{ width: '100%', padding: 'var(--space-2)', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    className="button"
                    style={{ background: '#9b1c1c' }}
                    disabled={cancelling}
                    onClick={handleCancel}
                  >
                    {cancelling ? 'Cancelling…' : 'Confirm Cancellation'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={cancelling}
                    onClick={() => setShowCancelPrompt(false)}
                  >
                    Keep Order
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Paid Order Cancellation Policy Notice */}
        {order.status === 'paid' && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              ℹ️ <strong>Cancellation Policy:</strong> Paid orders cannot be cancelled through this customer prototype. If you need to request adjustments, please speak directly with organization staff or the treasurer.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
