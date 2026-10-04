import { useState } from 'react';
import { useListState } from '../../hooks/useListState.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import { api } from '../../services/api.js';
import { useResource } from '../../hooks/useResource.js';
import { money } from '../../utils/format.js';
import ModulePanel from '../../components/ModulePanel.jsx';

// @edit:INVENTORY_UI — modern inventory tracking and collection desk
export default function InventoryPage() {
  const list = useListState();
  const collection = useListState('collection');
  const r = useResource('/browse/inventory?' + list.query);
  const orders = useResource('/browse/fulfillment?' + collection.query);
  const catalog = useResource('/staff/inventory');

  const [activeTab, setActiveTab] = useState('stock'); // 'stock' | 'fulfillment'
  const [stockFilter, setStockFilter] = useState('all'); // 'all' | 'healthy' | 'low' | 'out'
  const [showComposer, setShowComposer] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(path, body, successMsg) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(path, { method: 'POST', body });
      r.reload();
      orders.reload();
      catalog.reload();
      if (successMsg) setNotice(successMsg);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form));
    v.priceMinor = Math.round(Number(v.price) * 100);
    delete v.price;
    v.stock = Number(v.stock);
    if (!v.productId) delete v.productId;

    if (await request('/staff/products', v, 'Product / variant created successfully.')) {
      form.reset();
      setShowComposer(false);
      list.search('');
    }
  }

  const rawVariants = r.data?.data || [];
  const paidOrders = orders.data?.data || [];

  const totalUnits = rawVariants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  const lowStockCount = rawVariants.filter((v) => v.stock > 0 && v.stock <= 10).length;
  const outOfStockCount = rawVariants.filter((v) => Number(v.stock) <= 0).length;

  const filteredVariants = rawVariants.filter((v) => {
    const s = Number(v.stock);
    if (stockFilter === 'healthy') return s > 10;
    if (stockFilter === 'low') return s > 0 && s <= 10;
    if (stockFilter === 'out') return s <= 0;
    return true;
  });

  return (
    <ModulePanel
      title="Inventory & Order Fulfillment"
      description="Track warehouse merchandise stock levels, apply inventory shipments, and record customer collection."
      resource={r}
    >
      {/* Top Level KPI Metrics */}
      <div className="inventory-dashboard-bar">
        <div className="inventory-stats-row">
          <div className="inventory-stat-card">
            <span className="inventory-stat-label">Total SKUs / Variants</span>
            <span className="inventory-stat-val">{rawVariants.length}</span>
          </div>
          <div className="inventory-stat-card">
            <span className="inventory-stat-label">Units In Stock</span>
            <span className="inventory-stat-val healthy">{totalUnits}</span>
          </div>
          <div className="inventory-stat-card">
            <span className="inventory-stat-label">Low Stock (≤ 10)</span>
            <span className="inventory-stat-val low">{lowStockCount}</span>
          </div>
          <div
            className="inventory-stat-card"
            style={{ cursor: 'pointer' }}
            onClick={() => setActiveTab('fulfillment')}
          >
            <span className="inventory-stat-label">Awaiting Pickup</span>
            <span className="inventory-stat-val orders">{paidOrders.length}</span>
          </div>
        </div>

        {/* Tab Navigation: Stock vs Pickup Fulfillment */}
        <div className="inventory-tabs-bar" role="tablist">
          <button
            type="button"
            className={`inventory-tab-btn ${activeTab === 'stock' ? 'active' : ''}`}
            onClick={() => setActiveTab('stock')}
          >
            <span>📦</span> Stock & Products
            <span className="inventory-tab-badge">{rawVariants.length}</span>
          </button>
          <button
            type="button"
            className={`inventory-tab-btn ${activeTab === 'fulfillment' ? 'active' : ''}`}
            onClick={() => setActiveTab('fulfillment')}
          >
            <span>🛍️</span> Pickup Desk
            <span className="inventory-tab-badge">{paidOrders.length}</span>
          </button>
        </div>

        {/* Controls row for Stock Tab */}
        {activeTab === 'stock' && (
          <div className="inventory-controls-row">
            <div className="inventory-filter-pills" role="tablist" aria-label="Stock level filter">
              <button
                type="button"
                className={`inventory-filter-pill ${stockFilter === 'all' ? 'active' : ''}`}
                onClick={() => setStockFilter('all')}
              >
                All Items ({rawVariants.length})
              </button>
              <button
                type="button"
                className={`inventory-filter-pill ${stockFilter === 'healthy' ? 'active' : ''}`}
                onClick={() => setStockFilter('healthy')}
              >
                ✓ Healthy (&gt;10)
              </button>
              <button
                type="button"
                className={`inventory-filter-pill ${stockFilter === 'low' ? 'active' : ''}`}
                onClick={() => setStockFilter('low')}
              >
                ⚠️ Low Stock ({lowStockCount})
              </button>
              {outOfStockCount > 0 && (
                <button
                  type="button"
                  className={`inventory-filter-pill ${stockFilter === 'out' ? 'active' : ''}`}
                  onClick={() => setStockFilter('out')}
                >
                  ✕ Out of Stock ({outOfStockCount})
                </button>
              )}
            </div>

            <button
              type="button"
              className="inventory-create-btn"
              onClick={() => setShowComposer(!showComposer)}
            >
              {showComposer ? '✕ Close Form' : '+ Add Product or Size'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="form-error" style={{ marginBlock: 'var(--space-3)' }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status" style={{ marginBlock: 'var(--space-3)' }}>
          {notice}
        </p>
      )}

      {/* Product & Variant Composer Drawer */}
      {activeTab === 'stock' && showComposer && (
        <form className="inventory-composer-card module-form" onSubmit={create}>
          <div className="inventory-composer-header">
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
              <span>📦</span> Add Product or Variant
            </h2>
            <button
              type="button"
              className="button button-secondary"
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
              onClick={() => setShowComposer(false)}
            >
              Close
            </button>
          </div>

          <label>
            Product Catalog Group
            <select name="productId">
              <option value="">+ Create brand new product</option>
              {[...new Map((catalog.data?.data || []).map((p) => [p.id, p])).values()].map((p) => (
                <option key={p.id} value={p.id}>
                  Add size to: {p.name}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <label>
              Product Name
              <input
                name="name"
                minLength="3"
                maxLength="100"
                required
                placeholder="e.g. Skyline Vintage Hoodie"
              />
            </label>
            <label>
              Category
              <input
                name="category"
                maxLength="50"
                defaultValue="apparel"
                placeholder="e.g. apparel, accessories, stationary"
              />
            </label>
          </div>

          <label>
            Description (optional)
            <textarea
              name="description"
              maxLength="3000"
              rows="2"
              placeholder="Material, fit, washing instructions..."
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <label>
              Size / Variant Name
              <input
                name="size"
                maxLength="50"
                required
                placeholder="e.g. Large / Forest Green"
              />
            </label>
            <label>
              Price (major units)
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                max="1000000"
                required
                placeholder="e.g. 450.00"
              />
            </label>
            <label>
              Currency
              <select name="currency" defaultValue="INR">
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </label>
            <label>
              Initial Stock Units
              <input
                name="stock"
                type="number"
                min="0"
                max="100000"
                step="1"
                required
                placeholder="e.g. 50"
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '0.65rem', marginTop: '0.5rem' }}>
            <button className="button" disabled={busy}>
              {busy ? 'Saving…' : 'Save Product Variant'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setShowComposer(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* TAB 1: STOCK & PRODUCTS */}
      {activeTab === 'stock' && (
        <>
          <ListSearch list={list} label="Search product name, size, variant or SKU" />

          <div className="inventory-grid">
            {!r.loading &&
              filteredVariants.map((p) => (
                <InventoryCard
                  key={p.variantId || p.id}
                  item={p}
                  busy={busy}
                  onAdjust={(delta) =>
                    request(
                      '/staff/inventory/' + (p.variantId || p.id) + '/adjust',
                      { delta },
                      `Updated stock for ${p.name} (${p.size}) by ${delta > 0 ? '+' : ''}${delta} units.`
                    )
                  }
                />
              ))}
          </div>

          {!r.loading && filteredVariants.length === 0 && (
            <EmptyList
              title={list.q ? 'No matching products or sizes' : 'No items in this stock filter'}
              message={
                list.q
                  ? 'Try another search keyword or clear filters.'
                  : 'Variants added to inventory will appear here.'
              }
            />
          )}

          <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="Inventory" />
        </>
      )}

      {/* TAB 2: PICKUP DESK & FULFILLMENT */}
      {activeTab === 'fulfillment' && (
        <section style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
                Paid Orders Ready for Pickup
              </h2>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                Verify customer credentials and mark items handed over when collected.
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.8rem' }}
              onClick={() => orders.reload()}
            >
              🔄 Refresh Orders
            </button>
          </div>

          <ListSearch list={collection} label="Search customer name, email or order ID" />

          {orders.error && <p role="alert" className="form-error">{orders.error}</p>}

          <div className="fulfillment-grid">
            {!orders.loading &&
              paidOrders.map((o) => (
                <FulfillmentCard
                  key={o.id}
                  order={o}
                  busy={busy}
                  onFulfill={() =>
                    request(
                      '/staff/orders/' + o.id + '/fulfill',
                      {},
                      `Order #${o.id.slice(0, 8)} marked as collected & fulfilled.`
                    )
                  }
                />
              ))}
          </div>

          {!orders.loading && paidOrders.length === 0 && (
            <EmptyList
              title="All caught up!"
              message="There are currently no paid orders awaiting customer collection."
            />
          )}

          <Pagination
            list={collection}
            pagination={orders.data?.pagination}
            loading={orders.loading}
            label="Collection orders"
          />
        </section>
      )}
    </ModulePanel>
  );
}

function InventoryCard({ item, busy, onAdjust }) {
  const stock = Number(item.stock) || 0;
  const statusTier = stock > 10 ? 'healthy' : stock > 0 ? 'low' : 'out';
  const [customDelta, setCustomDelta] = useState('');

  function handleCustomSubmit(e) {
    e.preventDefault();
    const d = parseInt(customDelta, 10);
    if (!isNaN(d) && d !== 0) {
      onAdjust(d);
      setCustomDelta('');
    }
  }

  return (
    <article className="inventory-card">
      <div className={`inventory-card-stripe ${statusTier}`} />

      <div className="inventory-card-content">
        {/* Top: Status Badge & Size Pill */}
        <div className="inventory-card-topbar">
          <span className={`inventory-stock-tag ${statusTier}`}>
            {statusTier === 'healthy' && `✓ In Stock: ${stock}`}
            {statusTier === 'low' && `⚠️ Low: ${stock} Left`}
            {statusTier === 'out' && `✕ Out of Stock`}
          </span>

          <span className="inventory-variant-pill">{item.size}</span>
        </div>

        {/* Product Title */}
        <h2 className="inventory-product-title">{item.name}</h2>

        {/* Price & Quantity Box */}
        <div className="inventory-details-row">
          <div>
            <span style={{ fontSize: '0.72rem', display: 'block', color: 'var(--color-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Retail Price
            </span>
            <span className="inventory-price">{money(item.priceMinor, item.currency)}</span>
          </div>

          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.72rem', display: 'block', color: 'var(--color-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Available
            </span>
            <span className="inventory-units-badge">
              📦 <strong>{stock}</strong> units
            </span>
          </div>
        </div>

        {/* Quick Steppers & Adjustment Form */}
        <div className="inventory-adjust-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="inventory-adjust-label">Quick Stock Adjust</span>
            <div className="inventory-quick-steppers">
              <button
                type="button"
                disabled={busy}
                className="inventory-step-btn add"
                onClick={() => onAdjust(5)}
                title="Add 5 units received"
              >
                +5
              </button>
              <button
                type="button"
                disabled={busy}
                className="inventory-step-btn add"
                onClick={() => onAdjust(1)}
                title="Add 1 unit"
              >
                +1
              </button>
              <button
                type="button"
                disabled={busy || stock <= 0}
                className="inventory-step-btn sub"
                onClick={() => onAdjust(-1)}
                title="Deduct 1 unit"
              >
                −1
              </button>
              <button
                type="button"
                disabled={busy || stock < 5}
                className="inventory-step-btn sub"
                onClick={() => onAdjust(-5)}
                title="Deduct 5 units"
              >
                −5
              </button>
            </div>
          </div>

          <form onSubmit={handleCustomSubmit} className="inventory-adjust-input-row" style={{ margin: 0 }}>
            <input
              type="number"
              min="-100000"
              max="100000"
              step="1"
              disabled={busy}
              placeholder="± Delta"
              value={customDelta}
              onChange={(e) => setCustomDelta(e.target.value)}
              required
            />
            <button
              className="button button-secondary"
              style={{ padding: '0.45rem 0.8rem', fontSize: '0.8rem' }}
              disabled={busy || !customDelta || parseInt(customDelta, 10) === 0}
            >
              {busy ? 'Updating…' : 'Apply Adjustment'}
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}

function FulfillmentCard({ order, busy, onFulfill }) {
  const avatarLetter = (order.userName || 'C').charAt(0).toUpperCase();
  const shortId = order.id ? order.id.slice(0, 8) : '';
  const items = order.items || [];

  return (
    <article className="fulfillment-card">
      <div className="fulfillment-stripe" />

      <div className="fulfillment-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="fulfillment-order-id-tag">Order #{shortId}</span>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#16a34a' }}>
            ● Paid & Verified
          </span>
        </div>

        <div className="fulfillment-user-row">
          <div className="fulfillment-avatar">{avatarLetter}</div>
          <div>
            <strong style={{ fontSize: '0.98rem', display: 'block', color: '#0f172a' }}>
              {order.userName}
            </strong>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
              {order.userEmail || 'Student Member'}
            </span>
          </div>
        </div>

        {items.length > 0 && (
          <div className="fulfillment-items-box">
            <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: '#64748b' }}>
              Items to Hand Over ({items.length})
            </span>
            {items.map((item, idx) => (
              <div key={item.id || idx} className="fulfillment-item-line">
                <span>
                  <strong>{item.quantity}x</strong> {item.productName}{' '}
                  {item.variantName ? `(${item.variantName})` : ''}
                </span>
                <span>{money(item.totalMinor, order.currency)}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 'auto' }}>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Total Paid:</span>
          <strong style={{ fontSize: '1.15rem', color: '#0f172a' }}>
            {money(order.totalMinor, order.currency)}
          </strong>
        </div>
      </div>

      <div className="fulfillment-actions-bar">
        <button
          type="button"
          className="button"
          style={{ width: '100%', background: '#163c34' }}
          disabled={busy}
          onClick={onFulfill}
        >
          {busy ? 'Processing…' : '✓ Mark Handed Over & Collected'}
        </button>
      </div>
    </article>
  );
}
