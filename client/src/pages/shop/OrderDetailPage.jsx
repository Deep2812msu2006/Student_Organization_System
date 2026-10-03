import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import { money, date } from '../../utils/format.js';

export default function OrderDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const justPlaced = searchParams.get('placed') === 'true';

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  const canCancel = order.status === 'pending' || order.status === 'paid';

  return (
    <section className="container shop-page">
      <Link className="muted" to="/orders" style={{ display: 'inline-block', marginBottom: 'var(--space-4)' }}>
        ← Back to My Orders
      </Link>

      {justPlaced && (
        <div className="status-badge paid" style={{ width: '100%', padding: 'var(--space-4)', marginBottom: 'var(--space-6)', borderRadius: '8px' }}>
          <strong>Order placed successfully!</strong> Items have been reserved in your name.
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
      </div>
    </section>
  );
}
