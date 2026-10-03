import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { money, date } from '../../utils/format.js';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await api('/orders/me');
        if (!ignore) setOrders(res.data || []);
      } catch (err) {
        if (!ignore) setError(err.message || 'Unable to load orders.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  function statusLabel(status) {
    switch (status) {
      case 'pending':
        return 'Awaiting Payment';
      case 'paid':
        return 'Paid';
      case 'fulfilled':
        return 'Fulfilled';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }

  return (
    <section className="container shop-page">
      <div className="shop-header">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>My Merchandise Orders</h1>
        <p className="muted">Review past merchandise purchases, status, and receipts.</p>
      </div>

      {loading && <p className="muted">Loading your orders…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {!loading && !error && orders.length === 0 && (
        <div className="order-summary-card" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
          <h2>No orders yet</h2>
          <p className="muted" style={{ marginBlock: 'var(--space-4)' }}>
            You haven't placed any merchandise orders yet.
          </p>
          <Link className="button" to="/shop" style={{ alignSelf: 'center' }}>
            Visit the Club Store
          </Link>
        </div>
      )}

      <div className="orders-list">
        {orders.map(order => {
          const itemCount = (order.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);

          return (
            <Link key={order.id} className="order-card" to={`/orders/${order.id}`}>
              <div className="order-header-row">
                <div>
                  <strong>Order #{order.id.slice(0, 8)}</strong>
                  <span className="muted" style={{ marginLeft: 'var(--space-3)', fontSize: '0.85rem' }}>
                    Placed on {date(order.createdAt)}
                  </span>
                </div>
                {/* @edit:ORDER_STATUS — order status badge and presentation */}
                <span className={`status-badge ${order.status}`}>
                  ● {statusLabel(order.status)}
                </span>
              </div>

              <div>
                <p className="muted" style={{ fontSize: '0.9rem', margin: 0 }}>
                  {itemCount} {itemCount === 1 ? 'item' : 'items'}:{' '}
                  {(order.items || []).map(i => `${i.quantity}× ${i.productName} (${i.variantName})`).join(', ')}
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
                <span style={{ fontWeight: 700, color: 'var(--color-brand)' }}>
                  Total: {money(order.totalMinor, order.currency)}
                </span>
                <span style={{ fontSize: '0.9rem', color: 'var(--color-brand)', fontWeight: 600 }}>
                  View Details →
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
