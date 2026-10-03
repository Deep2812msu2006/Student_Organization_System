import { createContext, useContext, useState, useEffect } from 'react';

const CartContext = createContext(null);
const CART_STORAGE_KEY = 'skyline_merch_cart';

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, [items]);

  function addToCart({ product, variant, quantity = 1 }) {
    setItems(prev => {
      const existingIndex = prev.findIndex(item => item.variantId === variant.id);
      if (existingIndex > -1) {
        const updated = [...prev];
        const currentQty = updated[existingIndex].quantity;
        const newQty = Math.min(variant.stockQuantity, currentQty + quantity);
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: newQty,
          maxStock: variant.stockQuantity,
          priceMinor: variant.priceMinor,
        };
        return updated;
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          category: product.category,
          variantId: variant.id,
          variantName: variant.name,
          sku: variant.sku,
          priceMinor: variant.priceMinor,
          currency: variant.currency,
          maxStock: variant.stockQuantity,
          quantity: Math.min(variant.stockQuantity, Math.max(1, quantity)),
        },
      ];
    });
  }

  function updateQuantity(variantId, quantity) {
    if (quantity <= 0) {
      removeFromCart(variantId);
      return;
    }
    setItems(prev =>
      prev.map(item => {
        if (item.variantId === variantId) {
          return { ...item, quantity: Math.min(item.maxStock || 50, quantity) };
        }
        return item;
      })
    );
  }

  function removeFromCart(variantId) {
    setItems(prev => prev.filter(item => item.variantId !== variantId));
  }

  function clearCart() {
    setItems([]);
  }

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalEstimatedMinor = items.reduce((sum, item) => sum + item.priceMinor * item.quantity, 0);
  const currency = items[0]?.currency || 'INR';

  return (
    <CartContext.Provider
      value={{
        items,
        itemCount,
        totalEstimatedMinor,
        currency,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
