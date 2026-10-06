import {Router} from 'express';
import Joi from 'joi';
import {requireUser,requireRole,requireCsrf} from '../middleware/auth.middleware.js';
import {validate} from '../middleware/validate.middleware.js';
import {HttpError} from '../utils/httpError.js';
import {transaction} from '../utils/transaction.js';
import {createProduct,createProductVariant} from '../model/merchandise.model.js';
const id=Joi.string().pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export function inventoryRouter(pool){
 const r=Router(),auth=requireUser(pool),staff=requireRole('organizer');
 r.param('id',(_req,_res,next,v)=>next(id.validate(v).error?new HttpError(400,'INVALID_ID','Invalid identifier.'):undefined));
 r.get('/staff/inventory',auth,staff,async(_req,res)=>res.json({data:(await pool.query(`SELECT p.id,p.name,p.is_published AS "isPublished",v.id AS "variantId",v.name AS size,
 v.price_minor AS "priceMinor",v.currency,v.stock_quantity AS stock
 FROM products p LEFT JOIN product_variants v ON v.product_id=p.id ORDER BY p.name,v.name LIMIT 200`)).rows}));
 r.post('/staff/products',auth,staff,requireCsrf,validate(Joi.object({
 name:Joi.string().trim().min(3).max(100).required(),description:Joi.string().allow('').max(3000).default(''),
 category:Joi.string().trim().max(50).default('apparel'),size:Joi.string().trim().max(50).required(),
 priceMinor:Joi.number().integer().min(0).max(100000000).required(),currency:Joi.string().valid('INR','USD','EUR','GBP').required(),
 stock:Joi.number().integer().min(0).max(100000).required(),productId:id.optional()
 })),async(req,res)=>{
 const data=await transaction(pool,async db=>{
 const v=req.validated;
 if(v.productId&&!(await db.query('SELECT 1 FROM products WHERE id=$1',[v.productId])).rowCount)throw new HttpError(404,'NOT_FOUND','Product not found.');
 const product=v.productId?{id:v.productId}:await createProduct(db,{name:v.name,description:v.description,category:v.category,createdBy:req.user.id});
 return createProductVariant(db,{productId:product.id,name:v.size,priceMinor:v.priceMinor,currency:v.currency,stockQuantity:v.stock});
 });res.status(201).json({data});
 });
 // @rule:STOCK_ADJUSTMENT — atomic delta, never overwrite stock based on a stale browser value.
 r.post('/staff/inventory/:id/adjust',auth,staff,requireCsrf,validate(Joi.object({delta:Joi.number().integer().min(-100000).max(100000).invalid(0).required()})),async(req,res)=>{
 const {rows}=await pool.query('UPDATE product_variants SET stock_quantity=stock_quantity+$2,updated_at=now() WHERE id=$1 AND stock_quantity+$2 BETWEEN 0 AND 1000000 RETURNING id,stock_quantity AS stock',[req.params.id,req.validated.delta]);
 if(!rows[0])throw new HttpError(409,'STOCK_CONFLICT','Variant missing or adjustment would make stock invalid. Refresh stock before trying again.');
 res.json({data:rows[0]});
 });
 r.put('/staff/inventory/:id',auth,staff,requireCsrf,validate(Joi.object({
  name:Joi.string().trim().min(2).max(100).optional(),
  category:Joi.string().trim().max(50).optional(),
  size:Joi.string().trim().max(50).optional(),
  priceMinor:Joi.number().integer().min(0).max(100000000).optional(),
  stock:Joi.number().integer().min(0).max(100000).optional()
 })),async(req,res)=>{
  const v=req.validated;
  const data=await transaction(pool,async db=>{
   const {rows:vRows}=await db.query('SELECT * FROM product_variants WHERE id=$1',[req.params.id]);
   if(!vRows[0])throw new HttpError(404,'NOT_FOUND','Variant not found.');
   const current=vRows[0];
   if(v.name||v.category){
    await db.query('UPDATE products SET name=COALESCE($2,name),category=COALESCE($3,category),updated_at=now() WHERE id=$1',[current.product_id,v.name||null,v.category||null]);
   }
   const {rows:updatedVar}=await db.query(
    'UPDATE product_variants SET name=COALESCE($2,name),price_minor=COALESCE($3,price_minor),stock_quantity=COALESCE($4,stock_quantity),updated_at=now() WHERE id=$1 RETURNING id,name AS size,price_minor AS "priceMinor",stock_quantity AS stock',
    [req.params.id,v.size||null,v.priceMinor!==undefined?v.priceMinor:null,v.stock!==undefined?v.stock:null]
   );
   return updatedVar[0];
  });res.json({data});
 });
 r.delete('/staff/inventory/:id',auth,staff,requireCsrf,async(req,res)=>{
  const {rowCount:hasOrders}=await pool.query('SELECT 1 FROM order_items WHERE variant_id=$1 LIMIT 1',[req.params.id]);
  if(hasOrders){
   throw new HttpError(409,'CANNOT_DELETE_ACTIVE_ORDER','Cannot delete this variant because it is referenced in past customer orders. You can set stock to 0 or edit its details instead.');
  }
  const {rows}=await pool.query('DELETE FROM product_variants WHERE id=$1 RETURNING product_id',[req.params.id]);
  if(!rows[0])throw new HttpError(404,'NOT_FOUND','Variant not found.');
  const {rowCount:remaining}=await pool.query('SELECT 1 FROM product_variants WHERE product_id=$1 LIMIT 1',[rows[0].product_id]);
  if(!remaining){
   await pool.query('DELETE FROM products WHERE id=$1',[rows[0].product_id]);
  }
  res.json({data:{deleted:true,id:req.params.id}});
 });
 r.get('/staff/orders/fulfillment',auth,staff,async(req,res)=>res.json({data:(await pool.query(`SELECT o.id,u.name,o.total_minor AS "totalMinor",o.currency,o.status FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='paid' ORDER BY o.created_at LIMIT 100`)).rows}));
 r.post('/staff/orders/:id/fulfill',auth,staff,requireCsrf,async(req,res)=>{
 const {rows}=await pool.query("UPDATE orders SET status='fulfilled',fulfilled_at=COALESCE(fulfilled_at,now()),updated_at=now() WHERE id=$1 AND status IN ('paid','fulfilled') RETURNING id,status",[req.params.id]);
 if(!rows[0])throw new HttpError(409,'ORDER_NOT_PAID','Only paid orders can be fulfilled.');
 res.json({data:rows[0]});
 });return r;
}
