import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {createApp} from '../app.js';
import {createUser,assignRole} from '../model/auth.model.js';
const url=process.env.NODE_TEST_DATABASE_URL;
test('search and pagination apply permissions before counting, with stable pages and literal queries',{skip:!url},async t=>{
 const pool=new pg.Pool({connectionString:url}),userIds=[],tag='search-'+randomUUID();
 const server=createApp({configured:true,pool},{sessionSecret:'search-test-secret-'.repeat(3),ticketSecret:'ticket-test-secret-'.repeat(3)}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v1';
 t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});try{
 await pool.query('DELETE FROM volunteer_tasks WHERE created_by=ANY($1::uuid[])',[userIds]);
 await pool.query('DELETE FROM announcements WHERE author_id=ANY($1::uuid[])',[userIds]);
 await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[userIds]);
 }finally{await pool.end();}});
 function agent(){let cookie='',csrf='';return async(path,method='GET',body)=>{
 const res=await fetch(base+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(res.headers.getSetCookie().length)cookie=res.headers.getSetCookie()[0].split(';')[0];
 const data=await res.json();if(data.data?.csrfToken)csrf=data.data.csrfToken;return {status:res.status,...data};
 };}
 async function account(role){const email=randomUUID()+'@example.test',password='Search-test-password1!';const u=await createUser(pool,{name:tag+role,email,passwordHash:await bcrypt.hash(password,4)});userIds.push(u.id);await assignRole(pool,{userId:u.id,roleName:role});const call=agent();await call('/auth/csrf');assert.equal((await call('/auth/login','POST',{email,password})).status,200);return {...u,call};}
 const org=await account('organizer'),member=await account('member'),other=await account('member'),treasurer=await account('treasurer'),guest=agent();
 for(let i=0;i<27;i++)await pool.query("INSERT INTO announcements(title,body,audience,status,author_id) VALUES($1,'Search fixture','public','published',$2)",[tag+' '+String(i).padStart(2,'0'),org.id]);
 await pool.query("INSERT INTO announcements(title,body,audience,status,author_id) VALUES($1,'private phrase','members','draft',$2)",[tag+' secret',org.id]);
 await pool.query("INSERT INTO volunteer_tasks(title,assignee_id,created_by) VALUES($1,$2,$3)",[tag+' task',member.id,org.id]);
 await t.test('stable nonoverlapping pages and exact filtered totals',async()=>{
 const first=await guest('/browse/announcements?q='+tag+'&page=1&pageSize=12'),second=await guest('/browse/announcements?q='+tag+'&page=2&pageSize=12'),last=await guest('/browse/announcements?q='+tag+'&page=3&pageSize=12');
 assert.equal(first.status,200);assert.equal(first.pagination.total,27);assert.equal(first.data.length,12);assert.equal(second.data.length,12);assert.equal(last.data.length,3);
 assert.equal(new Set([...first.data,...second.data,...last.data].map(x=>x.id)).size,27);
 const again=await guest('/browse/announcements?q='+tag+'&pageSize=12');assert.deepEqual(again.data.map(x=>x.id),first.data.map(x=>x.id));
 const beyond=await guest('/browse/announcements?q='+tag+'&page=999');assert.equal(beyond.data.length,0);assert.equal(beyond.pagination.total,27);
 assert.equal((await org.call('/browse/announcements?q='+tag)).pagination.total,28);
 });
 await t.test('global search protects drafts, private assignments and directory results',async()=>{
 const publicResults=await guest('/search?q='+tag+'&pageSize=50');assert.equal(publicResults.pagination.total,27);
 const mine=await member.call('/search?q='+tag+'&category=tasks');assert.equal(mine.pagination.total,1);
 assert.equal((await other.call('/search?q='+tag+'&category=tasks')).pagination.total,0);
 assert.equal((await member.call('/search?q='+tag+'&category=members')).pagination.total,0);
 assert.equal((await org.call('/search?q='+tag+'&category=members')).pagination.total,4);
 const item=mine.data[0],linked=await member.call('/browse/tasks?q='+item.id);assert.equal(linked.data[0].title,tag+' task');
 });
 await t.test('all protected browse endpoints reject unauthorized users',async()=>{
 for(const kind of ['members','mail','inventory','fulfillment','manage-events']){
 assert.equal((await guest('/browse/'+kind)).status,401);
 assert.equal((await member.call('/browse/'+kind)).status,403);
 assert.equal((await org.call('/browse/'+kind)).status,200);
 }
 for(const kind of ['dues','pending-orders','pending-registrations']){
 assert.equal((await member.call('/browse/'+kind)).status,403);
 assert.equal((await treasurer.call('/browse/'+kind)).status,200);
 }
 for(const kind of ['products','events','announcements'])assert.equal((await guest('/browse/'+kind)).status,200);
 for(const kind of ['orders','tickets','expenses','tasks'])assert.equal((await member.call('/browse/'+kind)).status,200);
 });
 await t.test('pagination validation and SQL-looking searches remain safe',async()=>{
 for(const query of ['page=0','page=-1','page=1.5','pageSize=0','pageSize=51','page=100001','q='+ 'x'.repeat(121),'unknown=1'])
 assert.equal((await guest('/browse/events?'+query)).status,400,query);
 assert.equal((await guest('/browse/no-such-resource')).status,404);
 const literal=await guest('/search?q='+encodeURIComponent("' OR 1=1 --"));assert.equal(literal.status,200);assert.equal(literal.pagination.total,0);
 const wildcard=await guest('/browse/announcements?q='+encodeURIComponent(tag+'%'));assert.equal(wildcard.pagination.total,0);
 });
 await t.test('status filters find records beyond page one before counting and paging',async()=>{
 await pool.query("INSERT INTO volunteer_tasks(title,assignee_id,created_by,status,created_at) SELECT $1||i,$2,$3,CASE WHEN i=1 THEN 'done' ELSE 'todo' END,now()+i*interval '1 second' FROM generate_series(1,14)i",[tag+' paged-task-',member.id,org.id]);
 const done=await member.call('/browse/tasks?q='+tag+'%20paged-task-&category=done');
 assert.equal(done.status,200);assert.equal(done.pagination.total,1);assert.equal(done.data[0].status,'done');
 const todo=await member.call('/browse/tasks?q='+tag+'%20paged-task-&category=todo&pageSize=12');
 assert.equal(todo.pagination.total,13);assert.equal(todo.data.length,12);
 assert.equal((await other.call('/browse/tasks?q='+tag+'%20paged-task-&category=done')).pagination.total,0);
 assert.equal((await org.call('/browse/announcements?q='+tag+'&category=drafts')).pagination.total,1);
 assert.equal((await guest('/browse/announcements?q='+tag+'&category=drafts')).pagination.total,0);
 });

});
