import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../app.js';
import { assignRole } from '../model/auth.model.js';
import { getMemberProfile, createMembership } from '../model/member.model.js';
import { membershipExpiry } from '../services/member.service.js';

const url=process.env.NODE_TEST_DATABASE_URL;
const planId='00000000-0000-0000-0000-000000000001';
async function harness(t){
  const pool=new pg.Pool({connectionString:url});
  const config={sessionSecret:randomBytes(32).toString('hex'),production:false,membershipYearEndMonth:3,membershipYearEndDay:31};
  const server=createApp({configured:true,pool},config).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const prefix=`api-${randomUUID()}`;
  let cookie='',csrf='';
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  t.after(async()=>{
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    try{
      await pool.query("DELETE FROM sessions WHERE sess->>'userId' IN (SELECT id::text FROM users WHERE email LIKE $1)",[`${prefix}%`]);
      await pool.query('DELETE FROM users WHERE email LIKE $1',[`${prefix}%`]);
    }finally{await pool.end();}
  });
  async function request(path,{method='GET',body,token=true,cookieOverride}={}){
    const response=await fetch(base+path,{method,headers:{...(cookieOverride!==undefined?{Cookie:cookieOverride}:cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(token?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const set=response.headers.getSetCookie();if(set.length)cookie=set[0].split(';')[0];
    const result=response.status===204?null:await response.json();
    if(result?.data?.csrfToken)csrf=result.data.csrfToken;
    return {status:response.status,result,headers:response.headers};
  }
  return {pool,prefix,request,getCookie:()=>cookie};
}

test('auth/member workflow persists, rejects privilege changes, protects directory and invalidates logout', {skip:!url},async t=>{
  const h=await harness(t);
  assert.equal((await h.request('/members/me')).status,401);
  await h.request('/auth/csrf');
  const input={name:'API Student',email:`${h.prefix}@example.test`,password:'Test-Unique-Password1!'};
  assert.equal((await h.request('/auth/register',{method:'POST',body:input,token:false})).status,403);
  assert.equal((await h.request('/auth/register',{method:'POST',body:{...input,role:'treasurer'}})).status,400);
  const created=await h.request('/auth/register',{method:'POST',body:input});
  assert.equal(created.status,201);assert.deepEqual(created.result.data.user.roles,['member']);
  assert.ok(!JSON.stringify(created.result).includes('password'));
  assert.match(created.headers.get('set-cookie'),/HttpOnly/);
  assert.match(created.headers.get('set-cookie'),/SameSite=Lax/);
  const userId=created.result.data.user.id;
  const sessions=await h.pool.query("SELECT sid FROM sessions WHERE sess->>'userId'=$1",[userId]);assert.equal(sessions.rowCount,1);
  assert.equal((await h.request('/auth/me')).result.data.user.id,userId);
  assert.equal((await h.request('/members')).status,403);
  assert.equal((await h.request('/memberships',{method:'POST',body:{planId,paid:true}})).status,400);
  const responses=await Promise.all([h.request('/memberships',{method:'POST',body:{planId}}),h.request('/memberships',{method:'POST',body:{planId}})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const profile=await h.request('/members/me');
  assert.equal(profile.result.data.membershipStatus,'pending');assert.equal(profile.result.data.benefits.eligible,false);
  assert.equal(profile.result.data.benefits.ticketDiscountPct,0);
  assert.equal((await h.pool.query('SELECT id FROM membership_periods WHERE user_id=$1',[userId])).rowCount,1);
  await assignRole(h.pool,{userId,roleName:'organizer'});
  assert.equal((await h.request('/members')).status,200);
  assert.equal((await h.request('/members?page=0')).status,400);
  const oldCookie=h.getCookie();assert.equal((await h.request('/auth/logout',{method:'POST'})).status,204);
  assert.equal((await h.request('/auth/me',{cookieOverride:oldCookie})).status,401);
  await h.request('/auth/csrf');
  assert.equal((await h.request('/auth/login',{method:'POST',body:{email:input.email,password:'incorrect'}})).status,401);
  assert.equal((await h.request('/auth/login',{method:'POST',body:{email:input.email,password:input.password}})).status,200);
  assert.equal((await h.request('/members/me')).result.data.name,input.name);
  assert.equal((await h.request('/auth/register',{method:'POST',body:{...input,email:`  ${input.email.toUpperCase()}  `}})).status,409);
});

test('a future renewal does not mask active membership; expiration removes benefits', {skip:!url},async t=>{
  const h=await harness(t);await h.request('/auth/csrf');
  const created=await h.request('/auth/register',{method:'POST',body:{name:'Renewal Member',email:`${h.prefix}@example.test`,password:'Another-Password1!'}});
  const userId=created.result.data.user.id;
  const client=await h.pool.connect();
  try{
    await client.query('BEGIN');
    const current=await createMembership(client,{userId,planId,startsAt:'2026-01-01Z',expiresAt:'2027-01-01Z',duesAmountMinor:50000,currency:'INR'});
    await client.query("UPDATE dues_obligations SET status='paid',paid_at=now() WHERE id=$1",[current.duesObligationId]);
    await createMembership(client,{userId,planId,startsAt:'2027-01-01Z',expiresAt:'2028-01-01Z',duesAmountMinor:50000,currency:'INR'});
    await client.query('COMMIT');
    assert.equal((await getMemberProfile(h.pool,userId,'2026-10-03Z')).membershipStatus,'active');
    assert.equal((await getMemberProfile(h.pool,userId,'2028-01-01Z')).membershipStatus,'expired');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});

test('membership expiry uses the next configured year end, with an exclusive boundary',()=>{
  assert.equal(membershipExpiry(new Date('2026-01-05Z'),3,31).toISOString(),'2026-04-01T00:00:00.000Z');
  assert.equal(membershipExpiry(new Date('2026-10-03Z'),3,31).toISOString(),'2027-04-01T00:00:00.000Z');
  assert.equal(membershipExpiry(new Date('2026-04-01Z'),3,31).toISOString(),'2027-04-01T00:00:00.000Z');
});
