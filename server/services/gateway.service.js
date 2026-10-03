import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { HttpError } from '../utils/httpError.js';

// @rule:GATEWAY_PAYMENT_BINDING — a signature alone cannot prove which club purchase was paid.
// Fetch the server-created order and captured payment; match owner, purchase, amount and currency.
export async function verifyGatewayPayment(payload, expected, gateway) {
  const {razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature} = payload || {};
  if (typeof orderId !== 'string' || !/^order_[A-Za-z0-9]+$/.test(orderId) ||
      typeof paymentId !== 'string' || !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
      typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new HttpError(400, 'INVALID_PAYMENT_DETAILS', 'Invalid payment verification fields.');
  }
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !process.env.RAZORPAY_KEY_ID) throw new HttpError(503, 'PAYMENT_CONFIG_MISSING', 'Online payments are unavailable. Please pay club staff.');
  const digest = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest();
  if (!crypto.timingSafeEqual(digest, Buffer.from(signature, 'hex'))) throw new HttpError(400, 'INVALID_SIGNATURE', 'Payment signature is invalid.');
  const api = gateway || new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:secret});
  let order, payment;
  try { [order,payment] = await Promise.all([api.orders.fetch(orderId),api.payments.fetch(paymentId)]); }
  catch { throw new HttpError(502, 'PAYMENT_VERIFICATION_UNAVAILABLE', 'Could not confirm payment with the provider. Retry verification; do not pay again.'); }
  if (order.id !== orderId || payment.id !== paymentId || payment.order_id !== orderId ||
      order.notes?.userId !== expected.userId || order.notes?.[expected.targetField] !== expected.targetId ||
      order.amount !== expected.amountMinor || payment.amount !== expected.amountMinor ||
      order.currency !== expected.currency || payment.currency !== expected.currency) {
    throw new HttpError(409, 'PAYMENT_MISMATCH', 'This payment does not match this purchase.');
  }
  if (payment.status !== 'captured' || payment.captured !== true || payment.amount_refunded > 0) {
    throw new HttpError(409, 'PAYMENT_NOT_CAPTURED', 'Payment has not been captured or has been refunded. Contact club staff; do not pay again.');
  }
  return payment;
}
