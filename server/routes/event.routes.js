import {Router} from 'express';
import {requireUser,requireRole,requireCsrf} from '../middleware/auth.middleware.js';
import {validate} from '../middleware/validate.middleware.js';
import {paginationSchema} from '../validators/auth.schema.js';
import {eventSchema,eventPatchSchema,bookingSchema,idSchema,idempotencySchema} from '../validators/event.schema.js';
import {HttpError} from '../utils/httpError.js';
import * as model from '../model/event.model.js';
import * as service from '../services/event.service.js';

export function eventRouter(pool,config){
  const router=Router();
  const auth=requireUser(pool),staff=requireRole('organizer');
  router.param('id',(req,_res,next,value)=>{if(!idSchema.safeParse(value).success)return next(new HttpError(400,'INVALID_ID','Invalid event ID.'));next();});
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  async function list(req,res,includeUnpublished=false){const result=await model.listPublishedEvents(pool,{...req.validated,includeUnpublished});res.json({data:result.rows,pagination:{page:result.page,pageSize:result.pageSize,total:result.total}});}
  router.get('/events',validate(paginationSchema,'query'),(req,res)=>list(req,res));
  router.get('/events/:id',async(req,res)=>res.json({data:await service.detail(pool,req.params.id,req.session.userId)}));
  router.get('/organizer/events',auth,staff,validate(paginationSchema,'query'),(req,res)=>list(req,res,true));
  router.get('/organizer/events/:id',auth,staff,async(req,res)=>res.json({data:await service.detail(pool,req.params.id,req.user.id,true)}));
  router.post('/events',requireCsrf,auth,staff,validate(eventSchema),async(req,res)=>{service.validateDates(req.validated);res.status(201).json({data:await model.createEvent(pool,{...req.validated,createdBy:req.user.id})});});
  router.patch('/events/:id',requireCsrf,auth,staff,validate(eventPatchSchema),async(req,res)=>res.json({data:await service.editEvent(pool,req.params.id,req.validated)}));
  router.delete('/events/:id',requireCsrf,auth,staff,async(req,res)=>{
    const {rowCount:hasRegs}=await pool.query('SELECT 1 FROM registrations WHERE event_id=$1 LIMIT 1',[req.params.id]);
    if(hasRegs){
      await pool.query("UPDATE events SET status='cancelled',updated_at=now() WHERE id=$1",[req.params.id]);
      return res.json({data:{cancelled:true,message:'Event has registrations and was set to Cancelled.'}});
    }
    const {rows}=await pool.query('DELETE FROM events WHERE id=$1 RETURNING id',[req.params.id]);
    if(!rows[0])throw new HttpError(404,'NOT_FOUND','Event not found.');
    res.json({data:{deleted:true,id:req.params.id}});
  });
  router.post('/events/:id/registrations',requireCsrf,auth,validate(bookingSchema),async(req,res)=>{
    const key=idempotencySchema.safeParse(req.get('Idempotency-Key'));
    if(!key.success)throw new HttpError(400,'INVALID_IDEMPOTENCY_KEY','Supply a 16–100 character Idempotency-Key header (letters, digits, underscore or hyphen).');
    const result=await service.registerForEvent(pool,req.params.id,req.user.id,key.data,config.ticketSecret);
    res.status(result.replayed?200:201).json({data:result.registration,replayed:result.replayed});
  });
  router.get('/tickets/me',auth,async(req,res)=>res.json({data:await service.tickets(pool,req.user.id,config.ticketSecret)}));
  return router;
}
