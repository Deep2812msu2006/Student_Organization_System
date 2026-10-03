/**
 * Utility to load and trigger Razorpay Checkout in the browser.
 */

export function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      return resolve(true);
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/**
 * Open Razorpay Checkout modal for UPI / card / netbanking test payment.
 *
 * @param {object} params
 * @param {string} params.orderId - Internal database order ID
 * @param {string} params.razorpayOrderId - Razorpay Order ID (order_...)
 * @param {number} params.amountMinor - Total amount in paise / minor currency
 * @param {string} params.currency - e.g. 'INR'
 * @param {string} params.keyId - Razorpay public key ID
 * @param {object} params.user - Current user profile for prefilling
 * @param {Function} params.onSuccess - Callback on payment success with { razorpay_payment_id, razorpay_order_id, razorpay_signature }
 * @param {Function} [params.onDismiss] - Callback when user closes modal
 */
export async function triggerRazorpayPayment({
  orderId,
  razorpayOrderId,
  amountMinor,
  currency = 'INR',
  keyId,
  user,
  onSuccess,
  onDismiss,
}) {
  const loaded = await loadRazorpayScript();
  if (!loaded || !window.Razorpay) {
    throw new Error('Could not load Razorpay Checkout SDK. Please check your internet connection.');
  }

  const effectiveKey = keyId || import.meta.env.VITE_RAZORPAY_KEY_ID;
  if (!effectiveKey) {
    throw new Error('Razorpay Key ID is not configured.');
  }

  const options = {
    key: effectiveKey,
    amount: amountMinor,
    currency,
    name: 'Skyline Student Association',
    description: `Order #${orderId.slice(0, 8)} Payment`,
    image: '/logo.svg',
    order_id: razorpayOrderId,
    prefill: {
      name: user?.name || user?.fullName || 'Club Member',
      email: user?.email || '',
    },
    notes: {
      orderId,
    },
    theme: {
      color: '#163c34',
    },
    handler: function (response) {
      if (onSuccess) {
        onSuccess(response);
      }
    },
    modal: {
      ondismiss: function () {
        if (onDismiss) onDismiss();
      },
    },
  };

  const rzp = new window.Razorpay(options);
  rzp.open();
}
