/**
 * Product image resolver with static image mappings and fallbacks.
 */

const PRODUCT_IMAGE_MAP = {
  '60000000-0000-0000-0000-000000000001': '/images/products/hoodie.jpg',
  '60000000-0000-0000-0000-000000000002': '/images/products/water-bottle.jpg',
  '60000000-0000-0000-0000-000000000003': '/images/products/pin-set.jpg',
  '60000000-0000-0000-0000-000000000004': '/images/products/dad-cap.jpg',
  '60000000-0000-0000-0000-000000000005': '/images/products/oversized-tee.jpg',
  '60000000-0000-0000-0000-000000000006': '/images/products/backpack.jpg',
  '60000000-0000-0000-0000-000000000007': '/images/products/coffee-tumbler.jpg',
  '60000000-0000-0000-0000-000000000008': '/images/products/journal.jpg',
};

export function getProductImage(product) {
  if (product?.imageUrl) return product.imageUrl;
  if (product?.image_url) return product.image_url;
  if (product?.id && PRODUCT_IMAGE_MAP[product.id]) return PRODUCT_IMAGE_MAP[product.id];

  const name = (product?.name || '').toLowerCase();
  if (name.includes('hoodie')) return '/images/products/hoodie.jpg';
  if (name.includes('bottle')) return '/images/products/water-bottle.jpg';
  if (name.includes('pin')) return '/images/products/pin-set.jpg';
  if (name.includes('cap') || name.includes('hat')) return '/images/products/dad-cap.jpg';
  if (name.includes('tee') || name.includes('shirt')) return '/images/products/oversized-tee.jpg';
  if (name.includes('backpack') || name.includes('bag')) return '/images/products/backpack.jpg';
  if (name.includes('tumbler') || name.includes('mug') || name.includes('coffee')) return '/images/products/coffee-tumbler.jpg';
  if (name.includes('journal') || name.includes('notebook')) return '/images/products/journal.jpg';

  return null;
}
