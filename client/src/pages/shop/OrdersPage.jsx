import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useListState } from '../../hooks/useListState.js';
import { useResource } from '../../hooks/useResource.js';
import { ListSearch, Pagination } from '../../components/ListControls.jsx';
import ModulePanel from '../../components/ModulePanel.jsx';
import { money, date, shortOrderId } from '../../utils/format.js';
import { getProductImage } from '../../utils/productImages.js';

// @edit:ORDER_STATUS — modern order management UI with item thumbnails, steppers, and filters
export default function OrdersPage() {
  const list = useListState();
  const r = useResource('/browse/orders?' + list.query);
  const [statusFilter, setStatusFilter] = useState('all');

  const orders = r.data?.data || [];

  const counts = useMemo(() => {
    return {
      all: orders.length,
      pending: orders.filter((o) => o.status === 'pending').length,
      paid: orders.filter((o) => o.status === 'paid').length,
      fulfilled: orders.filter((o) => o.status === 'fulfilled').length,
      cancelled: orders.filter((o) => o.status === 'cancelled').length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (statusFilter === 'all') return orders;
    return orders.filter((o) => o.status === statusFilter);
  }, [orders, statusFilter]);

  function getStatusBadge(status) {
    switch (status) {
      case 'paid':
        return (
          <span className="status-badge paid" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.9rem' }}>✓</span> Paid & Confirmed
          </span>
        );
      case 'pending':
        return (
          <span className="status-badge pending" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.9rem' }}>⏳</span> Awaiting Payment
          </span>
        );
      case 'fulfilled':
        return (
          <span className="status-badge fulfilled" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.9rem' }}>🎉</span> Ready / Collected
          </span>
        );
      case 'cancelled':
        return (
          <span className="status-badge cancelled" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.9rem' }}>✕</span> Cancelled
          </span>
        );
      default:
        return <span className={`status-badge ${status}`}>{status}</span>;
    }
  }

  return (
    <ModulePanel
      title="My Merchandise Orders"
      description="Track club purchases, payment status, receipts, and campus collection details."
      resource={r}
    >
      <ListSearch list={list} label="Search order number, product or status">
        <Link className="button button-secondary" to="/shop" style={{ whiteSpace: 'nowrap' }}>
          🛍️ Shop Store
        </Link>
      </ListSearch>

      {/* Filter Tabs */}
      {!r.loading && orders.length > 0 && (
        <div className="orders-filter-bar" role="tablist" aria-label="Filter orders by status">
          <button
            type="button"
            className={`orders-tab-btn ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All Orders ({counts.all})
          </button>
          {counts.pending > 0 && (
            <button
              type="button"
              className={`orders-tab-btn ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pending')}
            >
              ⏳ Awaiting Payment ({counts.pending})
            </button>
          )}
          {counts.paid > 0 && (
            <button
              type="button"
              className={`orders-tab-btn ${statusFilter === 'paid' ? 'active' : ''}`}
              onClick={() => setStatusFilter('paid')}
            >
              ✓ Paid ({counts.paid})
            </button>
          )}
          {counts.fulfilled > 0 && (
            <button
              type="button"
              className={`orders-tab-btn ${statusFilter === 'fulfilled' ? 'active' : ''}`}
              onClick={() => setStatusFilter('fulfilled')}
            >
              🎉 Completed ({counts.fulfilled})
            </button>
          )}
          {counts.cancelled > 0 && (
            <button
              type="button"
              className={`orders-tab-btn ${statusFilter === 'cancelled' ? 'active' : ''}`}
              onClick={() => setStatusFilter('cancelled')}
            >
              ✕ Cancelled ({counts.cancelled})
            </button>
          )}
        </div>
      )}

      {/* Orders List */}
      <div className="orders-list">
        {!r.loading &&
          filteredOrders.map((o) => {
            const isPaid = o.status === 'paid' || o.status === 'fulfilled';
            const isFulfilled = o.status === 'fulfilled';
            const isCancelled = o.status === 'cancelled';

            return (
              <Link className="order-card" key={o.id} to={'/orders/' + o.id}>
                {/* Header */}
                <div className="order-header-row">
                  <div className="order-title-group">
                    <span className="order-number">
                      <span aria-hidden="true" style={{ fontSize: '1.2rem' }}>📦</span>
                      Order #{shortOrderId(o.id)}
                    </span>
                    <span className="order-date">
                      <span aria-hidden="true">📅</span>
                      Placed on {date(o.createdAt)}
                    </span>
                  </div>
                  <div>{getStatusBadge(o.status)}</div>
                </div>

                {/* Progress Stepper */}
                {!isCancelled ? (
                  <div className="order-tracker" aria-label="Order progress">
                    <div className="order-step completed">
                      <span className="order-step-dot">✓</span>
                      <span>Order Placed</span>
                    </div>
                    <div className={`order-step-line ${isPaid ? 'active' : ''}`} />
                    <div className={`order-step ${isPaid ? 'completed' : 'current'}`}>
                      <span className="order-step-dot">{isPaid ? '✓' : '2'}</span>
                      <span>{isPaid ? 'Payment Confirmed' : 'Payment Due'}</span>
                    </div>
                    <div className={`order-step-line ${isFulfilled ? 'active' : ''}`} />
                    <div className={`order-step ${isFulfilled ? 'completed' : ''}`}>
                      <span className="order-step-dot">{isFulfilled ? '✓' : '3'}</span>
                      <span>{isFulfilled ? 'Collected' : 'Awaiting Pickup'}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.65rem 1rem', fontSize: '0.85rem', color: '#64748b' }}>
                    ✕ This order was cancelled. Reserved items were restored to club inventory.
                  </div>
                )}

                {/* Itemized List with Product Photos */}
                <div className="order-items-preview">
                  {(o.items || []).map((item) => {
                    const itemImg = getProductImage({ name: item.productName });
                    return (
                      <div className="order-item-row" key={item.id}>
                        {itemImg ? (
                          <img src={itemImg} alt={item.productName} className="order-item-thumb" />
                        ) : (
                          <div
                            className="order-item-thumb"
                            style={{ display: 'grid', placeItems: 'center', fontSize: '1.4rem' }}
                          >
                            🛍️
                          </div>
                        )}
                        <div className="order-item-details">
                          <span className="order-item-name">{item.productName}</span>
                          <div className="order-item-meta">
                            <span className="order-item-chip">{item.variantName}</span>
                            <span>·</span>
                            <span>Qty: <strong>{item.quantity}</strong></span>
                            <span>·</span>
                            <span>{money(item.unitPriceMinor, o.currency)} each</span>
                          </div>
                        </div>
                        <div className="order-item-price">
                          {money(item.totalMinor, o.currency)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer with Total and Call to Action */}
                <div className="order-card-footer">
                  <div className="order-total-block">
                    <span className="order-total-label">
                      {o.status === 'paid' ? 'Total Paid' : o.status === 'pending' ? 'Amount Due' : 'Order Total'}
                    </span>
                    <span className="order-total-amount">
                      {money(o.totalMinor, o.currency)}
                    </span>
                  </div>

                  <div>
                    {o.status === 'pending' ? (
                      <span
                        className="button"
                        style={{
                          background: '#0f766e',
                          color: '#ffffff',
                          fontWeight: 700,
                          fontSize: '0.88rem',
                          padding: '0.5rem 1.1rem',
                          borderRadius: '8px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: '0 4px 12px rgba(15, 118, 110, 0.25)',
                        }}
                      >
                        ⚡ Pay Now via UPI →
                      </span>
                    ) : (
                      <span className="order-action-btn">
                        View Receipt & Pickup Details →
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
      </div>

      {/* Empty State */}
      {!r.loading && filteredOrders.length === 0 && (
        <div
          className="order-card"
          style={{
            textAlign: 'center',
            padding: '3rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.8rem',
            marginTop: '1.5rem',
          }}
        >
          <span style={{ fontSize: '3rem' }}>🛍️</span>
          <h3 style={{ margin: 0, fontSize: '1.25rem' }}>
            {statusFilter !== 'all' ? `No ${statusFilter} orders found` : list.q ? 'No matching orders found' : 'No orders placed yet'}
          </h3>
          <p className="muted" style={{ margin: 0, maxWidth: '400px', fontSize: '0.9rem' }}>
            {statusFilter !== 'all'
              ? 'Try selecting "All Orders" or changing your search keywords.'
              : 'Explore the Skyline club store for hoodies, water bottles, caps, and exclusive merchandise.'}
          </p>
          <div style={{ marginTop: '0.5rem' }}>
            {statusFilter !== 'all' ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setStatusFilter('all')}
              >
                Show All Orders
              </button>
            ) : (
              <Link className="button" to="/shop" style={{ background: '#0f766e', color: '#fff' }}>
                Explore Club Store ↗
              </Link>
            )}
          </div>
        </div>
      )}

      <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Orders" />
    </ModulePanel>
  );
}

