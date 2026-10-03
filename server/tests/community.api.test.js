import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {randomUUID} from 'node:crypto';
import {createApp} from '../app.js';
import {createUser,assignRole} from '../model/auth.model.js';
import {createEvent,insertRegistration} from '../model/event.model.js';
import {hashToken} from '../utils/ticketToken.js';
import {submitOrder} from '../services/merchandise.service.js';
import {createProduct,createProductVariant} from '../model/merchandise.model.js';
const databaseUrl=process.env.NODE_TEST_DATABASE_URL;
test('community integration: authorization, announcements, consent, reminders, tasks, discounts and inventory',{skip:!databaseUrl},async t=>{
 const pool=new pg.Pool({connectionString:databaseUrl}),users=[],products=[],plans=[],events=[];
 const server=createApp({configured:true,pool},{sessionSecret:'test-secret-'.repeat(4)}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/v1';
 t.after(async()=>{
 await new Promise(r=>{server.close(r);server.closeAllConnections();});
 try{
 await pool.query('DELETE FROM volunteer_tasks WHERE created_by=ANY($1::uuid[])',[users]);
 await pool.query('DELETE FROM announcements WHERE author_id=ANY($1::uuid[])',[users]);
 await pool.query('DELETE FROM payment_records WHERE recorded_by=ANY($1::uuid[])',[users]);
 await pool.query('DELETE FROM registrations WHERE event_id=ANY($1::uuid[])',[events]);
 await pool.query('DELETE FROM events WHERE id=ANY($1::uuid[])',[events]);
 await pool.query('DELETE FROM orders WHERE user_id=ANY($1::uuid[])',[users]);
 await pool.query('DELETE FROM products WHERE id=ANY($1::uuid[])',[products]);
 await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
 await pool.query('DELETE FROM membership_plans WHERE id=ANY($1::uuid[])',[plans]);
 }finally{await pool.end();}
 });
 function agent(){
 let cookie='',csrf='';
 return async(path,method='GET',body,extra={})=>{
 const response=await fetch(base+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json',...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(response.headers.getSetCookie().length)cookie=response.headers.getSetCookie()[0].split(';')[0];
 const result=await response.json();if(result.data?.csrfToken)csrf=result.data.csrfToken;
 return {status:response.status,...result};
 };
 }
 async function account(role){
 const email=randomUUID()+'@example.test',password='Integration-password1!';
 const u=await createUser(pool,{name:role,email,passwordHash:await bcrypt.hash(password,4)});users.push(u.id);
 await assignRole(pool,{userId:u.id,roleName:role});const call=agent();await call('/auth/csrf');assert.equal((await call('/auth/login','POST',{email,password})).status,200);
 return {id:u.id,call};
 }
 const org=await account('organizer'),member=await account('member'),other=await account('member'),anon=agent();
 await t.test('announcements protect drafts and reject unauthorized writes',async()=>{
 assert.equal((await member.call('/announcements','POST',{title:'Test',body:'Test announcement',audience:'public'})).status,403);
 assert.equal((await org.call('/announcements','POST',{title:'Test',body:'Test announcement',audience:'public'},{'X-CSRF-Token':''})).status,403);
 const a=await org.call('/announcements','POST',{title:'Test '+randomUUID(),body:'Welcome to the club',audience:'members'});assert.equal(a.status,201);
 assert.ok(!(await anon('/announcements')).data.some(x=>x.id===a.data.id));
 await member.call('/mail/preferences','PUT',{subscribed:true});
 assert.equal((await org.call('/announcements/'+a.data.id+'/publish','POST',{})).status,200);
 await org.call('/announcements/'+a.data.id+'/publish','POST',{});
 assert.ok(!(await anon('/announcements')).data.some(x=>x.id===a.data.id));
 assert.ok((await member.call('/announcements')).data.some(x=>x.id===a.data.id));
 assert.equal((await pool.query('SELECT count(*)::int n FROM message_outbox WHERE user_id=$1 AND source_key=$2',[member.id,'announcement:'+a.data.id])).rows[0].n,1);
 await member.call('/mail/preferences','PUT',{subscribed:false});
 await org.call('/staff/mail/preview','POST',{});
 assert.equal((await pool.query('SELECT status FROM message_outbox WHERE user_id=$1 AND source_key=$2',[member.id,'announcement:'+a.data.id])).rows[0].status,'suppressed');
 assert.equal((await member.call('/staff/mail')).status,403);
 const updated=await org.call('/announcements/'+a.data.id,'PUT',{title:'Updated Title',body:'Updated message content'});
 assert.equal(updated.status,200);
 assert.equal(updated.data.title,'Updated Title');
 assert.equal((await member.call('/announcements/'+a.data.id,'PUT',{title:'Hacked'})).status,403);
 assert.equal((await member.call('/announcements/'+a.data.id,'DELETE')).status,403);
 const del=await org.call('/announcements/'+a.data.id,'DELETE');
 assert.equal(del.status,200);
 assert.ok(!(await org.call('/announcements')).data.some(x=>x.id===a.data.id));
 });
 await t.test('event confirmation retries are atomic and reject changed payloads',async()=>{
 const event=await createEvent(pool,{title:'Payment race',venue:'Hall',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+172800000).toISOString(),capacity:10,memberPriceMinor:500,publicPriceMinor:1000,currency:'INR',status:'published',createdBy:org.id});events.push(event.id);
 const token=randomUUID();
 const reg=await insertRegistration(pool,{eventId:event.id,userId:member.id,priceMinor:500,currency:'INR',tokenHash:hashToken(token),idempotencyKey:randomUUID()});
 const payload={registrationId:reg.id,amountMinor:500,currency:'INR',method:'cash'},headers={'Idempotency-Key':randomUUID()};
 const results=await Promise.all([org.call('/payments/manual','POST',payload,headers),org.call('/payments/manual','POST',payload,headers)]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,201]);
 assert.equal((await org.call('/payments/manual','POST',{...payload,amountMinor:400},headers)).status,409);
 assert.equal((await org.call('/checkins','POST',{eventId:event.id,ticketToken:token})).status,200);
 assert.equal((await org.call('/checkins','POST',{eventId:event.id,ticketToken:token})).status,409);
 });
 await t.test('tasks are scoped to assignees and record status history',async()=>{
 const a=await org.call('/tasks','POST',{title:'Arrange chairs',assigneeId:member.id,description:'Before the event'});assert.equal(a.status,201);
 assert.ok((await member.call('/tasks')).data.some(x=>x.id===a.data.id));
 assert.ok(!(await other.call('/tasks')).data.some(x=>x.id===a.data.id));
 assert.equal((await other.call('/tasks/'+a.data.id,'PATCH',{status:'done'})).status,403);
 assert.equal((await member.call('/tasks/'+a.data.id,'PATCH',{status:'in_progress'})).status,200);
 assert.equal((await member.call('/tasks/'+a.data.id,'PATCH',{status:'done'})).status,200);
 assert.equal((await pool.query('SELECT count(*)::int n FROM task_history WHERE task_id=$1',[a.data.id])).rows[0].n,3);
 });
 await t.test('reminders deduplicate and respect opt-out; membership discounts snapshot prices',async()=>{
 const plan=(await pool.query("INSERT INTO membership_plans(name,dues_amount_minor,currency,merch_discount_pct) VALUES('Test discount',1000,'INR',10) RETURNING id")).rows[0];plans.push(plan.id);
 const period=(await pool.query("INSERT INTO membership_periods(user_id,plan_id,starts_at,expires_at,dues_amount_minor,currency) VALUES($1,$2,now()-interval '10 days',now()+interval '5 days',1000,'INR') RETURNING id",[member.id,plan.id])).rows[0];
 await pool.query("INSERT INTO dues_obligations(membership_period_id,amount_minor,currency,status,paid_at) VALUES($1,1000,'INR','paid',now())",[period.id]);
 await member.call('/mail/preferences','PUT',{subscribed:true});
 await Promise.all([org.call('/staff/reminders/run','POST',{days:14}),org.call('/staff/reminders/run','POST',{days:14})]);
 assert.equal((await pool.query("SELECT count(*)::int n FROM message_outbox WHERE user_id=$1 AND source_key LIKE 'renewal:%'",[member.id])).rows[0].n,1);
 const p=await createProduct(pool,{name:'Discounted shirt'});products.push(p.id);
 const v=await createProductVariant(pool,{productId:p.id,name:'M',priceMinor:1000,currency:'INR',stockQuantity:10});
 const result=await submitOrder(pool,member.id,{items:[{variantId:v.id,quantity:2}]},randomUUID());assert.equal(result.order.totalMinor,1800);
 await pool.query('UPDATE product_variants SET price_minor=2000 WHERE id=$1',[v.id]);
 assert.equal((await member.call('/orders/'+result.order.id)).data.totalMinor,1800);
 assert.equal((await member.call('/staff/inventory')).status,403);
 assert.equal((await org.call('/staff/inventory/'+v.id+'/adjust','POST',{delta:-100})).status,409);
 assert.equal((await org.call('/staff/inventory/'+v.id+'/adjust','POST',{delta:5})).status,200);
 assert.equal((await org.call('/staff/orders/'+result.order.id+'/fulfill','POST',{})).status,409);
 });
});
