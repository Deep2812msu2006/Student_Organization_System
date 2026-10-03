-- Migration: 011_product_images.sql
-- Add image_url to products for storefront product photos.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url TEXT;
