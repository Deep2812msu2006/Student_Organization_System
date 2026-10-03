import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { money } from '../../utils/format.js';
import { useCart } from '../../context/CartContext.jsx';

export default function ProductDetailPage() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addedNotice, setAddedNotice] = useState(false);
  const { addToCart, items } = useCart();

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
          <p className="product-detail-price">
            {selectedVariant ? money(selectedVariant.priceMinor, selectedVariant.currency) : '—'}
          </p>

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

          {/* Action Button */}
          <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <button
              className="button"
              type="button"
              disabled={!inStock || remainingStock <= 0}
              onClick={handleAdd}
            >
              {!inStock ? 'Sold Out' : remainingStock <= 0 ? 'All in Cart' : 'Add to Cart'}
            </button>
            <Link className="button button-secondary" to="/cart">
              Go to Cart
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
