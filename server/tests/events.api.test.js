import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {createApp} from '../app.js';
import {createUser,assignRole} from '../model/auth.model.js';
import {createMembership} from '../model/member.model.js';
import {hashToken} from '../utils/ticketToken.js';

const databaseUrl=process.env.NODE_TEST_DATABASE_URL;
test('event API: visibility, roles, pricing, concurrency, replay, snapshots and owner-only admission', {skip:!databaseUrl},async t=>{
 const pool=new pg.Pool({connectionString:databaseUrl,max:10});
 const config={sessionSecret:randomBytes(32).toString('hex'),ticketSecret:randomBytes(32).toString('hex')};
 const server=createApp({configured:true,pool},config).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/api/v1`;
 const prefix=`event-api-${randomUUID()}`,ids=[];
 t.after(async()=>{
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  try{
   await pool.query('DELETE FROM events WHERE created_by=ANY($1::uuid[])',[ids]);
   await pool.query("DELETE FROM sessions WHERE sess->>'userId'=ANY($1::text[])",[ids]);
   await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);
  }finally{await pool.end();}
 });
 function agent(){let cookie='',csrf='';return async(path,method='GET',body,headers={})=>{
  const response=await fetch(base+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  const set=response.headers.getSetCookie();if(set.length)cookie=set[0].split(';')[0];
  const data=response.status===204?null:await response.json();if(data?.data?.csrfToken)csrf=data.data.csrfToken;
  return {status:response.status,...data};
 };}
 async function account(label,role='member'){
  const email=`${prefix}-${label}@example.test`,password='Testing-event-password!';
  const user=await createUser(pool,{name:label,email,passwordHash:await bcrypt.hash(password,4)});ids.push(user.id);
  await assignRole(pool,{userId:user.id,roleName:role});
  const call=agent();await call('/auth/csrf');assert.equal((await call('/auth/login','POST',{email,password})).status,200);
  return {call,id:user.id};
 }
 const organizer=await account('organizer','organizer'),active=await account('active'),unpaid=await account('unpaid'),expired=await account('expired'),outsider=await account('outsider'),anonymous=agent();
 for(const [who,paid,past] of [[active,true,false],[unpaid,false,false],[expired,true,true]]){
  const c=await pool.connect();try{await c.query('BEGIN');const m=await createMembership(c,{userId:who.id,planId:'00000000-0000-0000-0000-000000000001',startsAt:new Date(Date.now()-10*86400000),expiresAt:new Date(Date.now()+(past?-1:30)*86400000),duesAmountMinor:50000,currency:'INR'});if(paid)await c.query("UPDATE dues_obligations SET status='paid',paid_at=now() WHERE id=$1",[m.duesObligationId]);await c.query('COMMIT');}finally{c.release();}
 }
 const payload={title:prefix,description:'Test event',venue:'Campus hall',startsAt:new Date(Date.now()+7*86400000).toISOString(),endsAt:new Date(Date.now()+7*86400000+3600000).toISOString(),capacity:10,memberPriceMinor:10000,publicPriceMinor:20000,currency:'INR',status:'draft'};
 assert.equal((await outsider.call('/events','POST',payload)).status,403);
 assert.equal((await organizer.call('/events','POST',{...payload,capacity:0})).status,400);
 assert.equal((await organizer.call('/events','POST',{...payload,endsAt:payload.startsAt})).status,400);
 assert.equal((await anonymous('/events/not-a-uuid')).status,400);
 const created=await organizer.call('/events','POST',payload);assert.equal(created.status,201);const id=created.data.id;
 assert.equal((await anonymous(`/events/${id}`)).status,404);
 assert.ok(!(await anonymous('/events?pageSize=50')).data.some(e=>e.id===id));
 assert.equal((await organizer.call(`/organizer/events/${id}`)).status,200);
 assert.equal((await outsider.call(`/events/${id}`,'PATCH',{title:'Hijack'})).status,403);
 assert.equal((await organizer.call(`/events/${id}`,'PATCH',{status:'published'})).status,200);
 assert.equal((await anonymous(`/events/${id}`)).status,200);
 assert.equal((await active.call(`/events/${id}`)).data.eligiblePriceMinor,10000);
 for(const who of [unpaid,expired,outsider])assert.equal((await who.call(`/events/${id}`)).data.eligiblePriceMinor,20000);
 const key=randomUUID();
 const book=(who,eventId=id,k=randomUUID(),body={})=>who.call(`/events/${eventId}/registrations`,'POST',body,{'Idempotency-Key':k});
 assert.equal((await book(active,id,key,{priceMinor:0,status:'confirmed'})).status,400);
 const reserved=await book(active,id,key);assert.equal(reserved.status,201);assert.equal(reserved.data.priceMinor,10000);assert.equal(reserved.data.status,'pending');
 const replay=await book(active,id,key);assert.equal(replay.status,200);assert.equal(replay.data.id,reserved.data.id);
 assert.equal((await book(active)).status,409);
 for(const who of [unpaid,expired,outsider])assert.equal((await book(who)).data.priceMinor,20000);
 assert.equal((await organizer.call(`/events/${id}`,'PATCH',{capacity:1})).status,409);
 assert.equal((await organizer.call(`/events/${id}`,'PATCH',{publicPriceMinor:30000})).status,200);
 assert.equal((await active.call('/tickets/me')).data[0].priceMinor,10000);
 assert.equal((await organizer.call(`/events/${id}`,'PATCH',{currency:'USD'})).status,409);
 assert.equal((await active.call('/tickets/me')).data[0].admissionCode,null);
 await pool.query("UPDATE registrations SET status='confirmed' WHERE id=$1",[reserved.data.id]); // Isolated fixture only; not an API/payment shortcut.
 const ticket=(await active.call('/tickets/me')).data[0];assert.ok(ticket.admissionCode.startsWith('sky1_'));assert.equal(ticket.tokenHash,undefined);
 const stored=await pool.query('SELECT token_hash FROM registrations WHERE id=$1',[ticket.id]);assert.equal(hashToken(ticket.admissionCode),stored.rows[0].token_hash);
 assert.equal((await active.call('/tickets/me')).data[0].admissionCode,ticket.admissionCode);
 assert.ok(!(await outsider.call('/tickets/me')).data.some(x=>x.id===ticket.id));
 assert.equal((await anonymous('/tickets/me')).status,401);
 const other=await organizer.call('/events','POST',{...payload,status:'published',capacity:1});const otherId=other.data.id;
 assert.equal((await book(active,otherId,key)).status,409);
 const race=await Promise.all([book(unpaid,otherId),book(expired,otherId)]);assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
 assert.equal((await book(outsider,otherId)).status,409);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM registrations WHERE event_id=$1 AND status IN ('pending','confirmed')",[otherId])).rows[0].n,1);
 await pool.query("UPDATE events SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id=$1",[otherId]);
 assert.equal((await book(organizer,otherId)).status,409);
});
