import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api.js';
import { money } from '../../utils/format.js';
import { useCart } from '../../context/CartContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { triggerRazorpayPayment } from '../../utils/razorpay.js';
import { getProductImage } from '../../utils/productImages.js';

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('upi'); // 'upi' or 'cash'
  const [loading, setLoading] = useState(true);
  const [processingPayment, setProcessingPayment] = useState(false);
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

  const effectiveUnitPrice = selectedVariant
    ? (memberBenefits?.merchDiscountPct > 0
        ? Math.floor(selectedVariant.priceMinor * (100 - memberBenefits.merchDiscountPct) / 100)
        : selectedVariant.priceMinor)
    : 0;
  const totalPriceMinor = effectiveUnitPrice * quantity;

  function handleAdd() {
    if (!selectedVariant || !inStock) return;
    addToCart({ product, variant: selectedVariant, quantity });
    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 4000);
  }

  async function handleBuyNow() {
    if (!selectedVariant || !inStock) return;
    if (!user) {
      navigate('/login?redirect=' + encodeURIComponent(`/shop/${id}`));
      return;
    }

    setProcessingPayment(true);
    setError('');

    try {
      const idempotencyKey = 'ord_' + crypto.randomUUID().replace(/-/g, '');
      const orderRes = await api('/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: {
          items: [{ variantId: selectedVariant.id, quantity }],
        },
      });

      const order = orderRes.data;

      if (paymentMethod === 'cash') {
        // Direct cash payment reservation at club desk
        navigate(`/orders/${order.id}?placed=true&method=cash`);
        return;
      }

      // UPI flow via Razorpay test gateway
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
            await api(`/orders/${order.id}/razorpay/verify`, {
              method: 'POST',
              body: rzpPayload,
            });
            // Direct purchase success — status set to paid without admin intervention
            navigate(`/orders/${order.id}?placed=true&paid=true&direct=true`);
          } catch (verifyErr) {
            setError(verifyErr.message || 'Payment verification failed.');
            navigate(`/orders/${order.id}?placed=true`);
          }
        },
        onDismiss: () => {
          navigate(`/orders/${order.id}?placed=true`);
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to initiate purchase.');
      setProcessingPayment(false);
    }
  }

  const productImg = getProductImage(product);

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

      {error && (
        <div className="form-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}

      <div className="product-detail-grid">
        <div
          className="product-detail-hero"
          style={{
            overflow: 'hidden',
            padding: 0,
            background: '#f8fafc',
            borderRadius: '1rem',
            border: '1px solid var(--color-border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
            height: '420px',
          }}
        >
          <img
            src={getProductImage(product)}
            alt={product.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
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

          {/* Choose Payment Method (Only UPI & Cash) */}
          <div className="payment-options-box" style={{ marginTop: 'var(--space-5)', padding: 'var(--space-4)', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-subtle, #f6f8f7)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 700, fontSize: '0.94rem' }}>
                <span aria-hidden="true">💳</span>
                <span>Select Payment Method</span>
              </div>
              <span style={{ fontSize: '0.78rem', background: '#e1f5fe', color: '#0277bd', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                {paymentMethod === 'upi' ? '⚡ Instant Direct Buy' : '💵 Pay at Desk'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              {/* UPI Option */}
              <button
                type="button"
                onClick={() => setPaymentMethod('upi')}
                style={{
                  textAlign: 'left',
                  padding: 'var(--space-3)',
                  background: paymentMethod === 'upi' ? '#f0fdf4' : 'var(--color-surface, #fff)',
                  borderRadius: '8px',
                  border: paymentMethod === 'upi' ? '2px solid #16a34a' : '1px solid var(--color-border)',
                  cursor: 'pointer',
                  boxShadow: paymentMethod === 'upi' ? '0 2px 8px rgba(22, 163, 74, 0.15)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: '0.92rem' }}>📱 UPI</strong>
                  <span style={{ fontSize: '0.7rem', background: '#16a34a', color: '#fff', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                    AUTO-VERIFY
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.78rem' }}>GPay, PhonePe, Paytm, QR</p>
                <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: '#16a34a', fontWeight: 600 }}>
                  ✓ Direct purchase without admin approval
                </p>
              </button>

              {/* Cash Option */}
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                style={{
                  textAlign: 'left',
                  padding: 'var(--space-3)',
                  background: paymentMethod === 'cash' ? '#fefce8' : 'var(--color-surface, #fff)',
                  borderRadius: '8px',
                  border: paymentMethod === 'cash' ? '2px solid #ca8a04' : '1px solid var(--color-border)',
                  cursor: 'pointer',
                  boxShadow: paymentMethod === 'cash' ? '0 2px 8px rgba(202, 138, 4, 0.15)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: '0.92rem' }}>💵 Cash</strong>
                  <span style={{ fontSize: '0.7rem', background: '#eab308', color: '#000', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    AT DESK
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.78rem' }}>At Skyline Club Desk</p>
                <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: '#854d0e', fontWeight: 500 }}>
                  Stock reserved; pay cash at counter
                </p>
              </button>
            </div>
          </div>

          {/* Action Buttons: Add to Cart and Flipkart-style Buy Now / Pay */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
            <button
              className="button button-secondary"
              type="button"
              disabled={!inStock || remainingStock <= 0 || processingPayment}
              onClick={handleAdd}
              style={{ flex: '1 1 140px' }}
            >
              {!inStock ? 'Sold Out' : remainingStock <= 0 ? 'All in Cart' : '🛒 Add to Cart'}
            </button>

            <button
              className="button"
              type="button"
              style={{
                flex: '2 1 220px',
                background: paymentMethod === 'upi' ? '#0f766e' : '#163c34',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-2)',
                boxShadow: '0 4px 12px rgba(15, 118, 110, 0.25)',
              }}
              disabled={!inStock || remainingStock <= 0 || processingPayment}
              onClick={handleBuyNow}
            >
              {processingPayment ? (
                '⏳ Opening Razorpay…'
              ) : (
                <>
                  <span>⚡ Buy Now · {selectedVariant ? money(totalPriceMinor, selectedVariant.currency) : '—'}</span>
                  {quantity > 1 && (
                    <span style={{ fontSize: '0.78rem', opacity: 0.85, fontWeight: 400 }}>
                      ({quantity} × {money(selectedVariant.priceMinor, selectedVariant.currency)})
                    </span>
                  )}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
