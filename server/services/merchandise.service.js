import crypto from 'node:crypto';
import {getMemberProfile} from '../model/member.model.js';
import * as model from '../model/merchandise.model.js';
import { transaction } from '../utils/transaction.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Compute canonical payload hash for an order's items to enforce idempotency consistency.
 *
 * @param {Array<{ variantId: string, quantity: number }>} items
 * @returns {string} Hex SHA-256 digest
 */
export function hashOrderPayload(items) {
  const canonical = [...items]
    .map(i => ({ variantId: i.variantId, quantity: i.quantity }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Fetch product catalog with pagination and optional category filter.
 */
export async function listCatalog(pool, { page, pageSize, category }) {
  return model.listPublishedProducts(pool, { page, pageSize, category });
}

/**
 * Get published product details with active variants.
 */
export async function detailProduct(pool, productId) {
  const product = await model.getProductById(pool, productId);
  if (!product || !product.isPublished) {
    throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }
  return product;
}

/**
 * Submit an order with atomic stock allocation and idempotency verification.
 *
 * @flow:ORDER_SUBMISSION — Transaction locks variants deterministically, checks stock,
 * decrements inventory, and inserts order with snapshotted items. Any stock failure
 * triggers an immediate atomic rollback.
 *
 * Invariants:
 *  - @rule:VARIANT_LOCK_ORDER: Locks variants in deterministic UUID ASC order.
 *  - @rule:STOCK_DEDUCT_ON_ORDER: Validates and decrements stock in the same transaction.
 *  - @rule:ORDER_IDEMPOTENCY: Safely replays matching requests; rejects altered payloads.
 */
export async function submitOrder(pool, userId, { items }, idempotencyKey) {
  if (!items || items.length === 0) {
    throw new HttpError(400, 'EMPTY_CART', 'Your order must contain at least one item.');
  }

  // Detect duplicate variant IDs in the request
  const variantIdSet = new Set(items.map(i => i.variantId));
  if (variantIdSet.size !== items.length) {
    throw new HttpError(400, 'DUPLICATE_ITEMS', 'Each variant should appear at most once in order items.');
  }

  const payloadHash = hashOrderPayload(items);

  return transaction(pool, async client => {
    // 1. Acquire advisory lock on idempotency key to serialize concurrent requests with the same key
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [idempotencyKey]);

    // 2. Check for existing order with this idempotency key (@rule:ORDER_IDEMPOTENCY)
    const existing = await model.findOrderByIdempotencyKey(client, idempotencyKey);
    if (existing) {
      if (existing.userId !== userId || existing.idempotencyPayloadHash !== payloadHash) {
        throw new HttpError(
          409,
          'IDEMPOTENCY_PAYLOAD_MISMATCH',
          'This idempotency key was already used for a different order.'
        );
      }
      const existingOrder = await model.getOrderDetails(client, existing.id, userId);
      return { order: existingOrder, replayed: true };
    }

    // 3. Lock variants deterministically by UUID ASC (@rule:VARIANT_LOCK_ORDER)
    const sortedVariantIds = [...variantIdSet].sort();
    const lockedVariants = await model.lockVariantsForOrder(client, sortedVariantIds);

    const variantMap = new Map(lockedVariants.map(v => [v.id, v]));

    // @rule:MEMBER_MERCH_PRICE — eligible paid membership applies the configured plan discount.
    const member=await getMemberProfile(client,userId,new Date());
    const plan=member?.membershipStatus==='active'?(await client.query('SELECT merch_discount_pct FROM membership_plans WHERE id=$1',[member.planId])).rows[0]:null;
    const discount=plan?.merch_discount_pct||0;
    for(const variant of lockedVariants) variant.priceMinor=Math.floor(variant.priceMinor*(100-discount)/100);
    // 4. Validate all variants exist, are active, and have sufficient stock
    for (const item of items) {
      const variant = variantMap.get(item.variantId);
      if (!variant || !variant.isActive || !variant.isPublished) {
        throw new HttpError(404, 'VARIANT_NOT_FOUND', `Product variant ${item.variantId} is no longer available.`);
      }

      if (variant.stockQuantity < item.quantity) {
        throw new HttpError(
          409,
          'INSUFFICIENT_STOCK',
          `Insufficient stock for "${variant.productName} (${variant.variantName})". Available: ${variant.stockQuantity}, requested: ${item.quantity}.`
        );
      }
    }

    // 5. Ensure uniform currency
    const currency = lockedVariants[0].currency;
    for (const v of lockedVariants) {
      if (v.currency !== currency) {
        throw new HttpError(400, 'CURRENCY_MISMATCH', 'All items in an order must use the same currency.');
      }
    }

    // 6. Deduct stock atomically for each item (@rule:STOCK_DEDUCT_ON_ORDER)
    for (const item of items) {
      const updated = await model.decrementVariantStock(client, {
        variantId: item.variantId,
        quantity: item.quantity,
      });

      if (!updated) {
        const v = variantMap.get(item.variantId);
        throw new HttpError(
          409,
          'INSUFFICIENT_STOCK',
          `Insufficient stock for "${v.productName} (${v.variantName})". Available: 0.`
        );
      }
    }

    // 7. Calculate trusted total from database snapshots (ignoring any client-supplied totals)
    let totalMinor = 0;
    for (const item of items) {
      const variant = variantMap.get(item.variantId);
      totalMinor += variant.priceMinor * item.quantity;
    }

    // 8. Insert order record (starts in pending status awaiting payment)
    const order = await model.insertOrder(client, {
      userId,
      currency,
      totalMinor,
      status: 'pending',
      idempotencyKey,
      payloadHash,
    });

    // 9. Insert item records with point-in-time name and price snapshots
    for (const item of items) {
      const variant = variantMap.get(item.variantId);
      await model.insertOrderItem(client, {
        orderId: order.id,
        variantId: variant.id,
        productNameSnapshot: variant.productName,
        variantNameSnapshot: variant.variantName,
        unitPriceMinor: variant.priceMinor,
        quantity: item.quantity,
        totalMinor: variant.priceMinor * item.quantity,
      });
    }

    // 10. Return complete order details
    const fullOrder = await model.getOrderDetails(client, order.id, userId);
    return { order: fullOrder, replayed: false };
  });
}

/**
 * List orders for the authenticated customer.
 */
export async function listCustomerOrders(pool, userId, pagination) {
  return model.listUserOrders(pool, userId, pagination);
}

/**
 * Get detailed view of an order owned by the authenticated customer.
 */
export async function getCustomerOrder(pool, orderId, userId) {
  const order = await model.getOrderDetails(pool, orderId, userId);
  if (!order) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  }
  return order;
}

/**
 * Cancel an order and restore stock exactly once.
 *
 * Invariants:
 *  - @rule:STOCK_RESTORE_ON_CANCEL: Only pending/paid orders can be cancelled;
 *    restores variant stock for each item inside the same transaction.
 */
export async function cancelCustomerOrder(pool, orderId, userId, reason) {
  // Check ownership
  const existing = await model.findOrderById(pool, orderId);
  if (!existing) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  }

  if (existing.userId !== userId) {
    throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to cancel this order.');
  }

  if (existing.status === 'cancelled') {
    throw new HttpError(409, 'ALREADY_CANCELLED', 'This order is already cancelled.');
  }

  if (existing.status === 'paid') {
    throw new HttpError(409, 'CANNOT_CANCEL', 'Paid orders cannot be cancelled directly. Contact staff for assistance.');
  }

  if (existing.status !== 'pending') {
    throw new HttpError(409, 'CANNOT_CANCEL', 'Only pending orders can be cancelled.');
  }

  return transaction(pool, async client => {
    const cancelled = await model.cancelOrder(client, {
      orderId,
      actorId: userId,
      reason: reason || 'Customer cancellation',
    });

    if (!cancelled) {
      throw new HttpError(409, 'CANNOT_CANCEL', 'Order could not be cancelled in its current state.');
    }

    return model.getOrderDetails(client, orderId, userId);
  });
}
