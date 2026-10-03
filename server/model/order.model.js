/**
 * server/model/order.model.js — Re-exports order and variant functions from merchandise.model.js
 */

export {
  listPublishedProducts as listProducts,
  getProductById,
  createProduct,
  createProductVariant,
  lockVariantsForOrder as lockVariants,
  decrementVariantStock as decrementStock,
  incrementVariantStock as incrementStock,
  insertOrder,
  insertOrderItem,
  findOrderById,
  findOrderByIdempotencyKey,
  getOrderDetails,
  cancelOrder,
  updateOrderStatus,
  listUserOrders,
} from './merchandise.model.js';
