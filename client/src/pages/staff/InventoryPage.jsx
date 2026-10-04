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
  const stockFilter = list.filter, setStockFilter = list.setFilter;
  const collection = useListState('collection');
  const r = useResource('/browse/inventory?' + list.query + '&category=' + encodeURIComponent(stockFilter));
  const orders = useResource('/browse/fulfillment?' + collection.query);
  const catalog = useResource('/staff/inventory');

  const [activeTab, setActiveTab] = useState('stock'); // 'stock' | 'fulfillment'
  const [showComposer, setShowComposer] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingVariant, setEditingVariant] = useState(null);
  const [deletingVariant, setDeletingVariant] = useState(null);

  async function request(path, body, successMsg, method = 'POST') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(path, { method, body });
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

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editingVariant) return;
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form));
    const payload = {
      name: v.name,
      category: v.category,
      size: v.size,
      priceMinor: Math.round(Number(v.price) * 100),
      stock: Number(v.stock),
    };
    const id = editingVariant.variantId || editingVariant.id;
    if (await request('/staff/inventory/' + id, payload, `Updated ${v.name} (${v.size}) successfully.`, 'PUT')) {
      setEditingVariant(null);
    }
  }

  async function handleDeleteVariant() {
    if (!deletingVariant) return;
    const id = deletingVariant.variantId || deletingVariant.id;
    if (await request('/staff/inventory/' + id, {}, `Deleted ${deletingVariant.name} (${deletingVariant.size}) successfully.`, 'DELETE')) {
      setDeletingVariant(null);
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
      <p className="muted">Stock counters show this page; filters search all inventory.</p>
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
              {(
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
                  onEdit={() => setEditingVariant(p)}
                  onDelete={() => setDeletingVariant(p)}
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

      {/* Edit Product & Variant Modal */}
      {editingVariant && (
        <div className="modal-backdrop" style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div className="module-form" style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '560px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#0f172a' }}>
                ✏️ Edit Product & Variant
              </h2>
              <button
                type="button"
                className="button button-secondary"
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}
                onClick={() => setEditingVariant(null)}
              >
                ✕ Close
              </button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', margin: 0 }}>
              <label>
                Product Title
                <input
                  name="name"
                  required
                  defaultValue={editingVariant.name}
                  placeholder="e.g. Skyline Vintage Dad Cap"
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label>
                  Category
                  <input
                    name="category"
                    defaultValue={editingVariant.category || 'apparel'}
                    placeholder="e.g. apparel, accessories"
                  />
                </label>
                <label>
                  Size / Variant Option
                  <input
                    name="size"
                    required
                    defaultValue={editingVariant.size}
                    placeholder="e.g. Forest Green, Medium"
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label>
                  Retail Price (₹)
                  <input
                    name="price"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={(editingVariant.priceMinor / 100).toFixed(2)}
                  />
                </label>
                <label>
                  Current Stock Units
                  <input
                    name="stock"
                    type="number"
                    min="0"
                    max="100000"
                    required
                    defaultValue={editingVariant.stock}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => setEditingVariant(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button"
                  style={{ background: '#163c34', color: '#fff' }}
                  disabled={busy}
                >
                  {busy ? 'Saving Changes…' : '✓ Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingVariant && (
        <div className="modal-backdrop" style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '460px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🗑️</div>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', color: '#0f172a' }}>
              Delete Variant?
            </h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#64748b', lineHeight: 1.5 }}>
              Are you sure you want to permanently delete <strong>{deletingVariant.name} ({deletingVariant.size})</strong>?
            </p>
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fee2e2',
              borderRadius: '8px',
              padding: '0.75rem',
              fontSize: '0.8rem',
              color: '#991b1b',
              marginBottom: '1.5rem',
              textAlign: 'left'
            }}>
              ⚠️ If this item was purchased in past customer orders, deletion will be blocked to preserve financial and receipt history.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setDeletingVariant(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button"
                style={{ background: '#dc2626', color: '#fff' }}
                disabled={busy}
                onClick={handleDeleteVariant}
              >
                {busy ? 'Deleting…' : 'Yes, Delete Item'}
              </button>
            </div>
          </div>
        </div>
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

function InventoryCard({ item, busy, onAdjust, onEdit, onDelete }) {
  const stock = Number(item.stock) || 0;
  const statusTier = stock > 10 ? 'healthy' : stock > 0 ? 'low' : 'out';
  const [customDelta, setCustomDelta] = useState('');
  const [cardNotice, setCardNotice] = useState('');
  const [cardBusy, setCardBusy] = useState(false);

  const deltaNum = parseInt(customDelta, 10);
  const hasValidDelta = !isNaN(deltaNum) && deltaNum !== 0;
  const projectedStock = hasValidDelta ? Math.max(0, stock + deltaNum) : stock;

  function stepDelta(amount) {
    const current = parseInt(customDelta, 10) || 0;
    const next = current + amount;
    setCustomDelta(next === 0 ? '' : String(next));
  }

  async function handleApply(deltaToApply) {
    const d = typeof deltaToApply === 'number' ? deltaToApply : deltaNum;
    if (isNaN(d) || d === 0) return;
    setCardBusy(true);
    setCardNotice('');
    try {
      const ok = await onAdjust(d);
      if (ok !== false) {
        setCustomDelta('');
        setCardNotice(`✓ Updated! ${d > 0 ? `+${d}` : d} units (New: ${Math.max(0, stock + d)})`);
        setTimeout(() => setCardNotice(''), 4000);
      }
    } finally {
      setCardBusy(false);
    }
  }

  function handleCustomSubmit(e) {
    e.preventDefault();
    if (hasValidDelta) {
      handleApply(deltaNum);
    }
  }

  return (
    <article className="inventory-card">
      <div className={`inventory-card-stripe ${statusTier}`} />

      <div className="inventory-card-content">
        {/* Top: Status Badge, Variant Pill & Edit/Delete Actions */}
        <div className="inventory-card-topbar">
          <span className={`inventory-stock-tag ${statusTier}`}>
            {statusTier === 'healthy' && `✓ In Stock: ${stock}`}
            {statusTier === 'low' && `⚠️ Low: ${stock} Left`}
            {statusTier === 'out' && `✕ Out of Stock`}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span className="inventory-variant-pill">{item.size}</span>
            <button
              type="button"
              className="button button-secondary"
              title="Edit product and variant"
              onClick={onEdit}
              disabled={busy}
              style={{
                padding: '0.2rem 0.55rem',
                fontSize: '0.74rem',
                fontWeight: 600,
                borderRadius: '6px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              ✏️ Edit
            </button>
            <button
              type="button"
              title="Delete variant"
              onClick={onDelete}
              disabled={busy}
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                borderRadius: '6px',
                padding: '0.2rem 0.45rem',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              🗑️
            </button>
          </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span className="inventory-adjust-label">Quick Stock Adjust</span>
            {hasValidDelta && (
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: deltaNum > 0 ? '#16a34a' : '#dc2626' }}>
                Preview: {stock} → <strong>{projectedStock}</strong> ({deltaNum > 0 ? `+${deltaNum}` : deltaNum})
              </span>
            )}
          </div>

          <div className="inventory-quick-steppers" style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={busy || cardBusy}
              className="inventory-step-btn add"
              onClick={() => stepDelta(5)}
              title="Add 5 units to delta"
            >
              +5
            </button>
            <button
              type="button"
              disabled={busy || cardBusy}
              className="inventory-step-btn add"
              onClick={() => stepDelta(1)}
              title="Add 1 unit to delta"
            >
              +1
            </button>
            <button
              type="button"
              disabled={busy || cardBusy || (stock + (parseInt(customDelta, 10) || 0) <= 0)}
              className="inventory-step-btn sub"
              onClick={() => stepDelta(-1)}
              title="Deduct 1 unit from delta"
            >
              −1
            </button>
            <button
              type="button"
              disabled={busy || cardBusy || (stock + (parseInt(customDelta, 10) || 0) < 5)}
              className="inventory-step-btn sub"
              onClick={() => stepDelta(-5)}
              title="Deduct 5 units from delta"
            >
              −5
            </button>
            {customDelta !== '' && (
              <button
                type="button"
                disabled={busy || cardBusy}
                className="inventory-step-btn"
                style={{ background: '#f1f5f9', color: '#64748b', borderColor: '#cbd5e1' }}
                onClick={() => setCustomDelta('')}
                title="Reset delta"
              >
                Clear
              </button>
            )}
          </div>

          <form onSubmit={handleCustomSubmit} className="inventory-adjust-input-row" style={{ margin: 0 }}>
            <input
              type="number"
              min={-stock}
              max="100000"
              step="1"
              disabled={busy || cardBusy}
              placeholder="± Delta"
              value={customDelta}
              onChange={(e) => setCustomDelta(e.target.value)}
            />
            <button
              type="submit"
              className={`button ${hasValidDelta ? 'button-primary' : 'button-secondary'}`}
              style={{
                padding: '0.45rem 0.8rem',
                fontSize: '0.8rem',
                fontWeight: hasValidDelta ? 700 : 500,
                background: hasValidDelta ? (deltaNum > 0 ? '#163c34' : '#b91c1c') : undefined,
                color: hasValidDelta ? '#ffffff' : undefined,
                transition: 'all 0.2s ease',
              }}
              disabled={busy || cardBusy || !hasValidDelta}
            >
              {cardBusy ? 'Updating…' : hasValidDelta ? `✓ Apply ${deltaNum > 0 ? `+${deltaNum}` : deltaNum}` : 'Apply Adjustment'}
            </button>
          </form>

          {cardNotice && (
            <div style={{
              marginTop: '0.5rem',
              padding: '0.35rem 0.6rem',
              background: '#dcfce7',
              color: '#15803d',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}>
              <span>🎉</span> {cardNotice}
            </div>
          )}
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
