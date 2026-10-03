import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api.js';
import { money } from '../../utils/format.js';
import { useCart } from '../../context/CartContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addedNotice, setAddedNotice] = useState(false);
  const [memberBenefits, setMemberBenefits] = useState(null);
  const { addToCart, items } = useCart();

  useEffect(() => {
    if (!user) {
      setMemberBenefits(null);
      return;
    }
    api('/members/me')
      .then(res => {
        if (res.data?.benefits?.eligible && res.data.membershipStatus === 'active') {
          setMemberBenefits(res.data.benefits);
        } else {
          setMemberBenefits(null);
        }
      })
      .catch(() => setMemberBenefits(null));
  }, [user]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await api(`/products/${id}`);
        if (!ignore) {
          setProduct(res.data);
          const firstAvailable = res.data.variants?.find(v => v.stockQuantity > 0) || res.data.variants?.[0];
          if (firstAvailable) setSelectedVariantId(firstAvailable.id);
        }
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load product details.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [id]);

  if (loading) {
    return (
      <section className="container shop-page">
        <p className="muted">Loading product details…</p>
      </section>
    );
  }

  if (error || !product) {
    return (
      <section className="container shop-page">
        <p className="form-error" role="alert">{error || 'Product not found.'}</p>
        <Link className="button button-secondary" to="/shop">← Back to Shop</Link>
      </section>
    );
  }

  const variants = product.variants || [];
  const selectedVariant = variants.find(v => v.id === selectedVariantId) || variants[0];
  const inStock = selectedVariant && selectedVariant.stockQuantity > 0;
  const cartItem = items.find(item => item.variantId === selectedVariantId);
  const cartQuantity = cartItem ? cartItem.quantity : 0;
  const remainingStock = selectedVariant ? selectedVariant.stockQuantity - cartQuantity : 0;

  function handleAdd() {
    if (!selectedVariant || !inStock) return;
    addToCart({ product, variant: selectedVariant, quantity });
    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 4000);
  }

  function handleBuyNow() {
    if (!selectedVariant || !inStock) return;
    addToCart({ product, variant: selectedVariant, quantity });
    navigate('/cart');
  }

  return (
    <section className="container shop-page">
      <Link className="muted" to="/shop" style={{ display: 'inline-block', marginBottom: 'var(--space-4)' }}>
        ← Back to Shop
      </Link>

      {addedNotice && (
        <div className="status-badge paid" style={{ width: '100%', padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-4)', borderRadius: '8px' }}>
          <span>Added {quantity} × {product.name} ({selectedVariant?.name}) to your cart!</span>
          <Link to="/cart" style={{ marginLeft: 'auto', fontWeight: 700, color: 'inherit' }}>View Cart →</Link>
        </div>
      )}

      <div className="product-detail-grid">
        <div className="product-detail-hero" aria-hidden="true">
          {product.category === 'apparel' ? '👕' : product.category === 'accessories' ? '🎒' : '✨'}
        </div>

        <div className="product-detail-info">
          <span className="product-card-category">{product.category}</span>
          <h1>{product.name}</h1>
          {selectedVariant && (
            <div style={{ marginBlock: 'var(--space-2)' }}>
              {memberBenefits?.merchDiscountPct > 0 ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <span className="product-detail-price" style={{ margin: 0, color: 'var(--color-primary-dark, #163c34)' }}>
                      {money(Math.floor(selectedVariant.priceMinor * (100 - memberBenefits.merchDiscountPct) / 100), selectedVariant.currency)}
                    </span>
                    <span className="muted" style={{ textDecoration: 'line-through', fontSize: '1.2rem' }}>
                      {money(selectedVariant.priceMinor, selectedVariant.currency)}
                    </span>
                    <span className="status-badge paid" style={{ fontSize: '0.8rem', padding: '3px 8px', borderRadius: '4px' }}>
                      {memberBenefits.merchDiscountPct}% MEMBER DISCOUNT
                    </span>
                  </div>
                  <p className="muted" style={{ fontSize: '0.84rem', margin: '4px 0 0', color: 'var(--color-primary-dark, #163c34)' }}>
                    ✨ Applied with your active membership benefits!
                  </p>
                </div>
              ) : (
                <div>
                  <p className="product-detail-price" style={{ margin: 0 }}>
                    {money(selectedVariant.priceMinor, selectedVariant.currency)}
                  </p>
                  <p className="muted" style={{ fontSize: '0.84rem', margin: '4px 0 0' }}>
                    Active Skyline members qualify for a 5% discount at checkout.
                  </p>
                </div>
              )}
            </div>
          )}

          <p>{product.description || 'Official club merchandise item.'}</p>

          {/* Variant Selector */}
          <div className="variant-selection">
            <span className="variant-label">Option / Size:</span>
            <div className="variant-options">
              {variants.map(variant => {
                const isAvailable = variant.stockQuantity > 0;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={!isAvailable}
                    className={`variant-option-btn ${selectedVariantId === variant.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedVariantId(variant.id);
                      setQuantity(1);
                    }}
                  >
                    {variant.name} {!isAvailable && '(Out of stock)'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stock Level Display */}
          <div style={{ marginBlock: 'var(--space-2)' }}>
            {selectedVariant && (
              <span className={`stock-tag ${inStock ? 'in-stock' : 'out-of-stock'}`}>
                {inStock ? `${selectedVariant.stockQuantity} in stock` : 'Out of Stock'}
              </span>
            )}
            {cartQuantity > 0 && (
              <span className="muted" style={{ marginLeft: 'var(--space-3)', fontSize: '0.85rem' }}>
                ({cartQuantity} currently in cart)
              </span>
            )}
          </div>

          {/* Quantity Stepper */}
          {inStock && (
            <div>
              <span className="variant-label">Quantity:</span>
              <div className="quantity-stepper">
                <button
                  type="button"
                  className="stepper-btn"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input
                  className="stepper-input"
                  type="number"
                  min="1"
                  max={remainingStock > 0 ? remainingStock : 1}
                  value={quantity}
                  onChange={e => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) setQuantity(Math.min(remainingStock > 0 ? remainingStock : 1, Math.max(1, val)));
                  }}
                />
                <button
                  type="button"
                  className="stepper-btn"
                  disabled={quantity >= remainingStock}
                  onClick={() => setQuantity(q => Math.min(remainingStock, q + 1))}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons: Add to Cart, Buy Now / Pay, Go to Cart */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button
              className="button"
              type="button"
              disabled={!inStock || remainingStock <= 0}
              onClick={handleAdd}
            >
              {!inStock ? 'Sold Out' : remainingStock <= 0 ? 'All in Cart' : 'Add to Cart'}
            </button>
            <button
              className="button"
              type="button"
              style={{ background: 'var(--color-primary-dark, #163c34)', color: '#fff' }}
              disabled={!inStock || remainingStock <= 0}
              onClick={handleBuyNow}
            >
              ⚡ Buy Now / Pay
            </button>
          </div>

          {/* Available Payment Options Display */}
          <div className="payment-options-box" style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-subtle, #f6f8f7)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600, fontSize: '0.92rem' }}>
              <span aria-hidden="true">💳</span>
              <span>Available Payment Options</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--color-surface, #fff)', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '0.84rem' }}>
                <strong>📱 UPI</strong>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.78rem' }}>GPay, PhonePe, Paytm</p>
              </div>
              <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--color-surface, #fff)', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '0.84rem' }}>
                <strong>💵 Cash</strong>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.78rem' }}>At Skyline Club Desk</p>
              </div>
              <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--color-surface, #fff)', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '0.84rem' }}>
                <strong>🏦 Bank Transfer</strong>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.78rem' }}>NEFT / IMPS transfer</p>
              </div>
            </div>
            <p className="muted" style={{ fontSize: '0.8rem', margin: 'var(--space-3) 0 0' }}>
              ✓ Stock is reserved immediately upon placing your order. Staff records and confirms your payment.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
