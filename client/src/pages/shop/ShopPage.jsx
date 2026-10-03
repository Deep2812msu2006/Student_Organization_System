import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { money } from '../../utils/format.js';
import { useCart } from '../../context/CartContext.jsx';

export default function ShopPage() {
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { itemCount } = useCart();

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const query = category ? `?category=${encodeURIComponent(category)}` : '';
        const res = await api(`/products${query}`);
        if (!ignore) setProducts(res.data || []);
      } catch (err) {
        if (!ignore) setError(err.message || 'Unable to load products.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [category]);

  const categories = [
    { label: 'All Items', value: '' },
    { label: 'Apparel', value: 'apparel' },
    { label: 'Accessories', value: 'accessories' },
    { label: 'Collectibles', value: 'collectibles' },
  ];

  return (
    // @edit:MERCHANDISE_LAYOUT — main shopping catalog layout and filters
    <section className="container shop-page">
      <div className="shop-header">
        <div className="shop-title-row">
          <div>
            <p className="eyebrow">OFFICIAL GEAR & MERCHANDISE</p>
            <h1>Skyline Club Store</h1>
            <p className="muted">Show your colors. Order official club apparel, accessories and collectibles.</p>
          </div>
          <div>
            <Link className="button button-secondary" to="/cart">
              View Cart {itemCount > 0 && <span className="cart-badge">{itemCount}</span>}
            </Link>
          </div>
        </div>

        <div className="shop-filters" role="group" aria-label="Category filters">
          {categories.map(cat => (
            <button
              key={cat.value}
              type="button"
              className={`filter-pill ${category === cat.value ? 'active' : ''}`}
              onClick={() => setCategory(cat.value)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="muted">Loading merchandise catalog…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {!loading && !error && products.length === 0 && (
        <div className="empty-card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <h3>No merchandise available</h3>
          <p className="muted">Check back soon for new club apparel and accessories.</p>
        </div>
      )}

      <div className="product-grid">
        {products.map(product => {
          const variants = product.variants || [];
          const inStock = variants.some(v => v.stockQuantity > 0);
          const minPrice = variants.length > 0 ? Math.min(...variants.map(v => v.priceMinor)) : 0;
          const maxPrice = variants.length > 0 ? Math.max(...variants.map(v => v.priceMinor)) : 0;
          const currency = variants[0]?.currency || 'INR';

          return (
            // @edit:PRODUCT_CARD — catalog product card presentation and pricing
            <Link key={product.id} className="product-card" to={`/shop/${product.id}`}>
              <div className="product-card-img-placeholder" aria-hidden="true">
                {product.category === 'apparel' ? '👕' : product.category === 'accessories' ? '🎒' : '✨'}
              </div>
              <div className="product-card-body">
                <span className="product-card-category">{product.category}</span>
                <h3 className="product-card-title">{product.name}</h3>
                <p className="product-card-desc">{product.description || 'No description provided.'}</p>
                <div className="product-card-footer">
                  <span className="product-card-price">
                    {minPrice === maxPrice
                      ? money(minPrice, currency)
                      : `${money(minPrice, currency)} – ${money(maxPrice, currency)}`}
                  </span>
                  <span className={`stock-tag ${inStock ? 'in-stock' : 'out-of-stock'}`}>
                    {inStock ? 'In Stock' : 'Sold Out'}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
