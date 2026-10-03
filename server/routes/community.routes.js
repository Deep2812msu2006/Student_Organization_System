import { Router } from 'express';
import Joi from 'joi';
import { requireUser,requireRole,requireCsrf } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { HttpError } from '../utils/httpError.js';
import { transaction } from '../utils/transaction.js';
import * as model from '../model/community.model.js';
import {runReminders,previewMail} from '../services/community.service.js';
const id=Joi.string().pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const announcement=Joi.object({title:Joi.string().trim().min(3).max(160).required(),body:Joi.string().trim().min(3).max(10000).required(),audience:Joi.string().valid('public','members').required()});
const updateAnnouncement=Joi.object({title:Joi.string().trim().min(3).max(160),body:Joi.string().trim().min(3).max(10000),audience:Joi.string().valid('public','members'),status:Joi.string().valid('draft','published')}).min(1);
export function communityRouter(pool) {
 const r=Router(),auth=requireUser(pool),staff=requireRole('organizer');
 r.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 r.param('id',(req,res,next,value)=>next(id.validate(value).error?new HttpError(400,'INVALID_ID','Invalid identifier.'):undefined));
 r.get('/announcements',async(req,res)=>{
  let organizer=false;
  if(req.session.userId) organizer=(await pool.query("SELECT 1 FROM user_roles WHERE user_id=$1 AND role_name='organizer'",[req.session.userId])).rowCount>0;
  res.json({data:await model.announcements(pool,organizer,!!req.session.userId)});
 });
 r.post('/announcements',auth,staff,requireCsrf,validate(announcement),async(req,res)=>{
  const {title,body,audience}=req.validated;
  const result=await pool.query('INSERT INTO announcements(title,body,audience,author_id) VALUES($1,$2,$3,$4) RETURNING *',[title,body,audience,req.user.id]);
  res.status(201).json({data:result.rows[0]});
 });
 r.post('/announcements/:id/publish',auth,staff,requireCsrf,async(req,res)=>{
  const data=await transaction(pool,async db=>{
   const {rows}=await db.query("UPDATE announcements SET status='published',published_at=COALESCE(published_at,now()) WHERE id=$1 RETURNING *",[req.params.id]);
   if(!rows[0]) throw new HttpError(404,'NOT_FOUND','Announcement not found.');
   await model.queueAnnouncement(db,rows[0]);return rows[0];
  });res.json({data});
 });
 r.put('/announcements/:id',auth,staff,requireCsrf,validate(updateAnnouncement),async(req,res)=>{
  const {title,body,audience,status}=req.validated;
  const {rows}=await pool.query(
   `UPDATE announcements
    SET title=COALESCE($1,title),
        body=COALESCE($2,body),
        audience=COALESCE($3,audience),
        status=COALESCE($4,status),
        published_at=CASE WHEN $4='published' AND published_at IS NULL THEN now() ELSE published_at END
    WHERE id=$5 RETURNING *`,
   [title||null,body||null,audience||null,status||null,req.params.id]
  );
  if(!rows[0]) throw new HttpError(404,'NOT_FOUND','Announcement not found.');
  res.json({data:rows[0]});
 });
 r.patch('/announcements/:id',auth,staff,requireCsrf,validate(updateAnnouncement),async(req,res)=>{
  const {title,body,audience,status}=req.validated;
  const {rows}=await pool.query(
   `UPDATE announcements
    SET title=COALESCE($1,title),
        body=COALESCE($2,body),
        audience=COALESCE($3,audience),
        status=COALESCE($4,status),
        published_at=CASE WHEN $4='published' AND published_at IS NULL THEN now() ELSE published_at END
    WHERE id=$5 RETURNING *`,
   [title||null,body||null,audience||null,status||null,req.params.id]
  );
  if(!rows[0]) throw new HttpError(404,'NOT_FOUND','Announcement not found.');
  res.json({data:rows[0]});
 });
 r.delete('/announcements/:id',auth,staff,requireCsrf,async(req,res)=>{
  const data=await transaction(pool,async db=>{
   await db.query("DELETE FROM message_outbox WHERE source_key='announcement:'||$1",[req.params.id]);
   const {rows}=await db.query('DELETE FROM announcements WHERE id=$1 RETURNING *',[req.params.id]);
   if(!rows[0]) throw new HttpError(404,'NOT_FOUND','Announcement not found.');
   return rows[0];
  });res.json({data:{id:data.id},message:'Announcement deleted successfully.'});
 });
 r.get('/mail/preferences',auth,async(req,res)=>res.json({data:{subscribed:(await pool.query('SELECT subscribed FROM mail_preferences WHERE user_id=$1',[req.user.id])).rows[0]?.subscribed||false}}));
 r.put('/mail/preferences',auth,requireCsrf,validate(Joi.object({subscribed:Joi.boolean().strict().required()})),async(req,res)=>{
  await pool.query('INSERT INTO mail_preferences(user_id,subscribed) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET subscribed=$2,updated_at=now()',[req.user.id,req.validated.subscribed]);
  res.json({data:req.validated});
 });
 r.get('/staff/mail',auth,staff,async(req,res)=>res.json({data:(await pool.query('SELECT o.id,u.email,o.subject,o.body,o.status,o.created_at AS "createdAt" FROM message_outbox o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 100')).rows}));
 r.post('/staff/reminders/run',auth,staff,requireCsrf,validate(Joi.object({days:Joi.number().integer().min(1).max(90).default(14)})),async(req,res)=>res.json({data:await runReminders(pool,req.validated.days)}));
 r.post('/staff/mail/preview',auth,staff,requireCsrf,async(req,res)=>res.json({data:await previewMail(pool)}));
 r.get('/tasks',auth,async(req,res)=>res.json({data:await model.tasks(pool,req.user.id,req.user.roles.includes('organizer'))}));
 r.get('/tasks/assignees',auth,staff,async(req,res)=>res.json({data:(await pool.query('SELECT id,name FROM users ORDER BY name LIMIT 200')).rows}));
 r.post('/tasks',auth,staff,requireCsrf,validate(Joi.object({
  title:Joi.string().trim().min(3).max(160).required(),description:Joi.string().allow('').max(3000).default(''),
  assigneeId:id.required(),eventId:id.allow(null).default(null),dueAt:Joi.string().isoDate().allow(null).default(null)
 })),async(req,res)=>{
  const v=req.validated;
  const data=await transaction(pool,async db=>{
   if(!(await db.query('SELECT 1 FROM users WHERE id=$1',[v.assigneeId])).rowCount) throw new HttpError(400,'INVALID_ASSIGNEE','Assignee not found.');
   if(v.eventId&&!(await db.query('SELECT 1 FROM events WHERE id=$1',[v.eventId])).rowCount) throw new HttpError(400,'INVALID_EVENT','Event not found.');
   const {rows}=await db.query('INSERT INTO volunteer_tasks(title,description,assignee_id,created_by,event_id,due_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[v.title,v.description,v.assigneeId,req.user.id,v.eventId,v.dueAt]);
   await db.query("INSERT INTO task_history(task_id,actor_id,status) VALUES($1,$2,'todo')",[rows[0].id,req.user.id]);return rows[0];
  });res.status(201).json({data});
 });
 r.patch('/tasks/:id',auth,requireCsrf,validate(Joi.object({status:Joi.string().valid('todo','in_progress','done').required()})),async(req,res)=>{
  const data=await transaction(pool,async db=>{
   const {rows}=await db.query('SELECT * FROM volunteer_tasks WHERE id=$1 FOR UPDATE',[req.params.id]);
   if(!rows[0])throw new HttpError(404,'NOT_FOUND','Task not found.');
   if(rows[0].assignee_id!==req.user.id&&!req.user.roles.includes('organizer'))throw new HttpError(403,'FORBIDDEN','Only the assignee or organizer may update this task.');
   const result=await db.query('UPDATE volunteer_tasks SET status=$2,updated_at=now() WHERE id=$1 RETURNING *',[req.params.id,req.validated.status]);
   await db.query('INSERT INTO task_history(task_id,actor_id,status) VALUES($1,$2,$3)',[req.params.id,req.user.id,req.validated.status]);return result.rows[0];
  });res.json({data});
 });return r;
}
