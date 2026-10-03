import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../services/api.js';
import { money } from '../../utils/format.js';
import { triggerRazorpayPayment } from '../../utils/razorpay.js';

export default function CartPage() {
  const { items, itemCount, totalEstimatedMinor, currency, updateQuantity, removeFromCart, clearCart } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [paymentMethod, setPaymentMethod] = useState('upi'); // 'upi' or 'cash'
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [stockConflict, setStockConflict] = useState(null);
  const [memberBenefits, setMemberBenefits] = useState(null);

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

  const discountPct = memberBenefits?.merchDiscountPct || 0;
  const discountMinor = discountPct > 0 ? Math.floor((totalEstimatedMinor * discountPct) / 100) : 0;
  const finalTotalMinor = totalEstimatedMinor - discountMinor;

  // Idempotency key preserved across retries of the identical cart; reset when cart items change
  const idempotencyKeyRef = useRef(null);
  const lastPayloadHashRef = useRef(null);

  function getOrCreateIdempotencyKey(payloadItems) {
    const canonical = JSON.stringify(payloadItems);
    if (!idempotencyKeyRef.current || lastPayloadHashRef.current !== canonical) {
      // Generate standard random UUID (without hyphens + padding to ensure 20+ chars)
      idempotencyKeyRef.current = 'ord_' + crypto.randomUUID().replace(/-/g, '');
      lastPayloadHashRef.current = canonical;
    }
    return idempotencyKeyRef.current;
  }

  async function handleCheckout(e) {
    e.preventDefault();
    if (!user) {
      navigate('/login?redirect=/cart');
      return;
    }
    if (items.length === 0) return;

    setSubmitting(true);
    setError('');
    setStockConflict(null);

    const payloadItems = items.map(i => ({
      variantId: i.variantId,
      quantity: i.quantity,
    }));

    const idempotencyKey = getOrCreateIdempotencyKey(payloadItems);

    try {
      // POST order with Idempotency-Key header and CSRF
      const res = await api('/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: { items: payloadItems },
      });

      const order = res.data;

      if (paymentMethod === 'cash') {
        clearCart();
        navigate(`/orders/${order.id}?placed=true&method=cash`);
        return;
      }

      // UPI checkout via Razorpay test gateway
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
            clearCart();
            // Direct buy success — status is directly Paid without admin intervention
            navigate(`/orders/${order.id}?placed=true&paid=true&direct=true`);
          } catch (verifyErr) {
            clearCart();
            setError(verifyErr.message || 'Payment verification failed.');
            navigate(`/orders/${order.id}?placed=true`);
          }
        },
        onDismiss: () => {
          clearCart();
          navigate(`/orders/${order.id}?placed=true`);
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to place order. Please try again.');
      if (err.status === 409) {
        setStockConflict(err.message);
      }
      setSubmitting(false);
    }
  }

  if (items.length === 0) {
    return (
      <section className="container shop-page">
        {/* @edit:CART_UI — shopping cart and checkout UI */}
        <div className="order-summary-card" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
          <h2>Your Cart is Empty</h2>
          <p className="muted" style={{ marginBlock: 'var(--space-4)' }}>
            You haven't added any club merchandise items yet.
          </p>
          <Link className="button" to="/shop" style={{ alignSelf: 'center' }}>
            Explore Club Merchandise
          </Link>
        </div>
      </section>
    );
  }

  return (
    // @edit:CART_UI — shopping cart and checkout UI
    <section className="container shop-page">
      <div className="shop-header">
        <p className="eyebrow">ORDER REVIEW</p>
        <h1>Shopping Cart ({itemCount} {itemCount === 1 ? 'item' : 'items'})</h1>
      </div>

      {error && <div className="form-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}
      {stockConflict && (
        <div className="status-badge pending" style={{ width: '100%', padding: 'var(--space-3)', marginBottom: 'var(--space-4)', borderRadius: '8px' }}>
          <strong>Inventory notice:</strong> {stockConflict} Please update the quantities in your cart.
        </div>
      )}

      <div className="cart-layout">
        <div>
          <table className="cart-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Price</th>
                <th>Quantity</th>
                <th>Subtotal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.variantId}>
                  <td>
                    <div className="cart-item-name">{item.productName}</div>
                    <div className="cart-item-variant">Option: {item.variantName}</div>
                  </td>
                  <td>{money(item.priceMinor, item.currency)}</td>
                  <td>
                    <div className="quantity-stepper" style={{ margin: 0 }}>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span style={{ minWidth: '24px', textAlign: 'center', fontWeight: 600 }}>
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        className="stepper-btn"
                        disabled={item.maxStock !== undefined && item.quantity >= item.maxStock}
                        onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {money(item.priceMinor * item.quantity, item.currency)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cart-remove-btn"
                      onClick={() => removeFromCart(item.variantId)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'space-between' }}>
            <Link className="button button-secondary" to="/shop">
              ← Continue Shopping
            </Link>
            <button
              type="button"
              className="button button-secondary"
              onClick={clearCart}
            >
              Clear Cart
            </button>
          </div>
        </div>

        {/* Order Summary Box */}
        <aside className="order-summary-card">
          <h3>Order Summary</h3>
          <div className="summary-row">
            <span>Items count:</span>
            <span>{itemCount}</span>
          </div>
          <div className="summary-row">
            <span>Estimated Subtotal:</span>
            <span>{money(totalEstimatedMinor, currency)}</span>
          </div>

          {discountPct > 0 && (
            <div className="summary-row" style={{ color: 'var(--color-primary-dark, #163c34)', fontWeight: 600 }}>
              <span>Member Discount ({discountPct}%):</span>
              <span>−{money(discountMinor, currency)}</span>
            </div>
          )}

          <div className="summary-row total">
            <span>Estimated Total:</span>
            <span>{money(finalTotalMinor, currency)}</span>
          </div>

          {/* Payment Method Selector (Only UPI & Cash) */}
          <div style={{ marginBlock: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--color-subtle, #f6f8f7)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, display: 'block', marginBottom: 'var(--space-2)' }}>
              Choose Payment Method:
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <button
                type="button"
                onClick={() => setPaymentMethod('upi')}
                style={{
                  textAlign: 'left',
                  padding: 'var(--space-2) var(--space-3)',
                  background: paymentMethod === 'upi' ? '#f0fdf4' : 'var(--color-surface, #fff)',
                  borderRadius: '6px',
                  border: paymentMethod === 'upi' ? '2px solid #16a34a' : '1px solid var(--color-border)',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                }}
              >
                <strong>📱 UPI</strong>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.72rem' }}>Instant Razorpay</p>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                style={{
                  textAlign: 'left',
                  padding: 'var(--space-2) var(--space-3)',
                  background: paymentMethod === 'cash' ? '#fefce8' : 'var(--color-surface, #fff)',
                  borderRadius: '6px',
                  border: paymentMethod === 'cash' ? '2px solid #ca8a04' : '1px solid var(--color-border)',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                }}
              >
                <strong>💵 Cash</strong>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.72rem' }}>Pay at Desk</p>
              </button>
            </div>
            <p className="muted" style={{ fontSize: '0.74rem', margin: 'var(--space-2) 0 0' }}>
              {paymentMethod === 'upi' ? '✓ Auto-verified as Paid immediately on payment.' : '✓ Reserved immediately. Pay at counter.'}
            </p>
          </div>

          {user ? (
            <button
              className="button full-width"
              type="button"
              style={{
                background: paymentMethod === 'upi' ? '#0f766e' : 'var(--color-primary-dark, #163c34)',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 700,
                padding: 'var(--space-3)',
                boxShadow: '0 4px 12px rgba(15, 118, 110, 0.25)',
              }}
              disabled={submitting || items.length === 0}
              onClick={handleCheckout}
            >
              {submitting ? (
                paymentMethod === 'upi' ? '⏳ Opening Razorpay…' : 'Placing Order…'
              ) : (
                paymentMethod === 'upi'
                  ? `⚡ Buy Cart / Pay · ${money(totalEstimatedMinor, currency)}`
                  : `Place Order · ${money(totalEstimatedMinor, currency)} (Cash)`
              )}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Sign in to Skyline to complete and place your order.
              </p>
              <Link className="button full-width" to="/login?redirect=/cart">
                Sign in to Order
              </Link>
              <Link className="button button-secondary full-width" to="/register">
                Create Account
              </Link>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
