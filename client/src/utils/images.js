/**
 * Image helpers to provide authentic, high-resolution photography for Events and Merchandise.
 */

export function getEventImage(event, index = 0) {
  if (event?.imageUrl) return event.imageUrl;
  const title = (event?.title || '').toLowerCase();
  const desc = (event?.description || '').toLowerCase();

  if (title.includes('web') || title.includes('code') || title.includes('develop') || desc.includes('web')) {
    return '/images/events/web_workshop.jpg';
  }
  if (title.includes('symposium') || title.includes('tech') || title.includes('annual') || desc.includes('keynote')) {
    return '/images/events/tech_symposium.jpg';
  }
  if (title.includes('hackathon') || desc.includes('hackathon')) {
    return '/images/events/hackathon.jpg';
  }
  if (title.includes('robot') || title.includes('ai') || title.includes('expo') || desc.includes('robot')) {
    return '/images/events/robotics_expo.jpg';
  }
  if (title.includes('conference') || title.includes('panel')) {
    return '/images/events/conference.jpg';
  }

  // Rotating realistic photos based on event ID / index
  const fallbacks = [
    '/images/events/campus_mixer.jpg',
    '/images/events/web_workshop.jpg',
    '/images/events/conference.jpg',
    '/images/events/tech_symposium.jpg',
    '/images/events/robotics_expo.jpg',
    '/images/events/hackathon.jpg',
  ];

  const idHash = (event?.id || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) + index;
  return fallbacks[idHash % fallbacks.length];
}

export function getProductImage(product) {
  if (product?.imageUrl) return product.imageUrl;
  const name = (product?.name || '').toLowerCase();
  const category = (product?.category || '').toLowerCase();

  if (name.includes('hoodie') || (category === 'apparel' && !name.includes('shirt'))) {
    return '/images/shop/hoodie.jpg';
  }
  if (name.includes('bottle') || name.includes('water') || category === 'accessories') {
    return '/images/shop/water_bottle.jpg';
  }
  if (name.includes('pin') || category === 'collectibles') {
    return '/images/shop/pin_set.jpg';
  }
  if (name.includes('shirt') || name.includes('tee')) {
    return '/images/shop/tshirt.jpg';
  }

  return '/images/shop/hoodie.jpg';
}
