// @rule:SEARCH_SCOPE — every allowlisted query applies record/role visibility before filtering or counting.
// Values always use parameters; SQL identifiers below are fixed source code, never user input.
const orderItems=`COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'productName',i.product_name_snapshot,'variantName',i.variant_name_snapshot,'unitPriceMinor',i.unit_price_minor_snapshot,'quantity',i.quantity,'totalMinor',i.total_minor) ORDER BY i.created_at,i.id) FROM order_items i WHERE i.order_id=o.id),'[]'::jsonb)`;
const orderBase=`SELECT o.id,o.created_at sort_key,o.id::text||' '||u.name||' '||o.status||' '||COALESCE((SELECT string_agg(product_name_snapshot,' ') FROM order_items WHERE order_id=o.id),'') search_text,
 o.status,o.total_minor AS "totalMinor",o.currency,o.created_at AS "createdAt",u.name AS "userName",u.email AS "userEmail",${orderItems} items
 FROM orders o JOIN users u ON u.id=o.user_id CROSS JOIN access a`;
const queries={
 events:`SELECT e.id,e.starts_at sort_key,e.title||' '||e.description||' '||e.venue search_text,e.title,e.description,e.venue,
 e.starts_at AS "startsAt",e.ends_at AS "endsAt",e.status,e.currency,e.member_price_minor AS "memberPriceMinor",
 e.public_price_minor AS "publicPriceMinor",GREATEST(0,e.capacity-(SELECT count(*) FROM registrations r WHERE r.event_id=e.id AND r.status IN ('pending','confirmed')))::int AS "seatsAvailable",
 (SELECT r.status FROM registrations r WHERE r.event_id=e.id AND r.user_id=a.uid AND r.status != 'cancelled' LIMIT 1) AS "userRegistrationStatus"
 FROM events e CROSS JOIN access a WHERE e.status='published'`,
 'manage-events':`SELECT e.id,e.starts_at sort_key,e.title||' '||e.description||' '||e.venue||' '||e.status search_text,e.title,e.description,e.venue,
 e.starts_at AS "startsAt",e.ends_at AS "endsAt",e.status,e.currency,e.member_price_minor AS "memberPriceMinor",
 e.public_price_minor AS "publicPriceMinor",GREATEST(0,e.capacity-(SELECT count(*) FROM registrations r WHERE r.event_id=e.id AND r.status IN ('pending','confirmed')))::int AS "seatsAvailable",
 (SELECT r.status FROM registrations r WHERE r.event_id=e.id AND r.user_id=a.uid AND r.status != 'cancelled' LIMIT 1) AS "userRegistrationStatus"
 FROM events e CROSS JOIN access a WHERE a.organizer`,
 products:`SELECT p.id,p.created_at sort_key,p.name||' '||p.description||' '||p.category search_text,p.name,p.description,p.category,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'priceMinor',v.price_minor,'currency',v.currency,'stockQuantity',v.stock_quantity) ORDER BY v.price_minor,v.id) FROM product_variants v WHERE v.product_id=p.id AND v.is_active),'[]'::jsonb) variants
 FROM products p CROSS JOIN access a WHERE p.is_published AND (a.category='' OR lower(p.category)=lower(a.category))`,
 announcements:`SELECT x.id,x.created_at sort_key,x.title||' '||x.body search_text,x.title,x.body,x.audience,x.status,x.created_at AS "createdAt",COALESCE(u.name, 'Club Staff') AS "authorName"
 FROM announcements x LEFT JOIN users u ON u.id=x.author_id CROSS JOIN access a WHERE a.organizer OR (x.status='published' AND (x.audience='public' OR a.uid IS NOT NULL))`,
 tasks:`SELECT t.id,t.created_at sort_key,t.title||' '||t.description||' '||u.name||' '||t.status search_text,t.title,t.description,t.status,t.due_at AS "dueAt",t.assignee_id AS "assigneeId",u.name AS "assigneeName"
 FROM volunteer_tasks t JOIN users u ON u.id=t.assignee_id CROSS JOIN access a WHERE a.organizer OR t.assignee_id=a.uid`,
 mail:`SELECT o.id,o.created_at sort_key,u.email||' '||o.subject||' '||o.status search_text,u.email,o.subject,o.body,o.status,o.created_at AS "createdAt"
 FROM message_outbox o JOIN users u ON u.id=o.user_id CROSS JOIN access a WHERE a.organizer`,
 expenses:`SELECT e.id,e.created_at sort_key,e.purpose||' '||u.name||' '||e.status search_text,e.purpose,e.status,e.amount_minor AS "amountMinor",e.currency,e.requester_id AS "requesterId",u.name AS "requesterName",e.created_at AS "createdAt"
 FROM expenses e JOIN users u ON u.id=e.requester_id CROSS JOIN access a WHERE a.finance OR e.requester_id=a.uid`,
 dues:`SELECT d.id,mp.starts_at sort_key,u.name||' '||u.email||' '||p.name search_text,d.amount_minor AS "amountMinor",d.currency,u.name AS "userName",u.email AS "userEmail",p.name AS "planName"
 FROM dues_obligations d JOIN membership_periods mp ON mp.id=d.membership_period_id JOIN users u ON u.id=mp.user_id JOIN membership_plans p ON p.id=mp.plan_id CROSS JOIN access a WHERE a.finance AND d.status='pending'`,
 members:`SELECT u.id,u.created_at sort_key,u.name||' '||u.email search_text,u.name,u.email,
 CASE WHEN mp.id IS NULL THEN 'none' WHEN mp.expires_at<=now() THEN 'expired' WHEN mp.starts_at>now() THEN 'future' WHEN d.status='paid' THEN 'active' ELSE 'pending' END AS "membershipStatus"
 FROM users u CROSS JOIN access a LEFT JOIN LATERAL(SELECT * FROM membership_periods WHERE user_id=u.id ORDER BY CASE WHEN starts_at<=now() AND expires_at>now() THEN 0 WHEN starts_at>now() THEN 1 ELSE 2 END,CASE WHEN starts_at>now() THEN starts_at END ASC,starts_at DESC,id LIMIT 1)mp ON true
 LEFT JOIN dues_obligations d ON d.membership_period_id=mp.id WHERE a.organizer`,
 inventory:`SELECT v.id,p.created_at sort_key,p.name||' '||v.name||' '||COALESCE(v.sku,'') search_text,p.id AS "productId",p.name,p.is_published AS "isPublished",v.id AS "variantId",v.name size,v.price_minor AS "priceMinor",v.currency,v.stock_quantity stock
 FROM products p JOIN product_variants v ON v.product_id=p.id CROSS JOIN access a WHERE a.organizer`,
 orders:orderBase+` WHERE o.user_id=a.uid`,
 'pending-orders':orderBase+` WHERE a.finance AND o.status='pending'`,
 fulfillment:orderBase+` WHERE a.organizer AND o.status='paid'`,
 'pending-registrations':`SELECT r.id,r.created_at sort_key,u.name||' '||u.email||' '||e.title search_text,r.price_minor AS "priceMinor",r.currency,u.name AS "userName",u.email AS "userEmail",e.title AS "eventTitle",r.event_id AS "eventId"
 FROM registrations r JOIN users u ON u.id=r.user_id JOIN events e ON e.id=r.event_id CROSS JOIN access a WHERE a.finance AND r.status='pending' AND e.status='published' AND e.ends_at>now()`,
 tickets:`SELECT r.id,r.created_at sort_key,e.title||' '||e.venue||' '||r.status search_text,r.price_minor AS "priceMinor",r.currency,r.status,r.checked_in_at AS "checkedInAt",e.id AS "eventId",e.title AS "eventTitle",e.venue AS "eventVenue",e.starts_at AS "eventStartsAt",e.ends_at AS "eventEndsAt",e.status AS "eventStatus",r.token_hash AS "_hash",r.idempotency_key AS "_key"
 FROM registrations r JOIN events e ON e.id=r.event_id CROSS JOIN access a WHERE r.user_id=a.uid`
};
export const publicResources=new Set(['events','products','announcements']);
export const staffResources=new Set(['manage-events','mail','members','inventory','fulfillment']);
export const financeResources=new Set(['dues','pending-orders','pending-registrations']);
export const resourceNames=Object.keys(queries);
// @rule:FILTER_BEFORE_PAGING — fixed predicates only; category values remain SQL parameters.
const browseFilters={
 tasks:"status=$5",expenses:"status=$5",mail:"status=$5",
 announcements:"(($5='drafts' AND status='draft') OR ($5 IN ('public','members') AND audience=$5))",
 inventory:"(($5='healthy' AND stock>10) OR ($5='low' AND stock BETWEEN 1 AND 10) OR ($5='out' AND stock=0))"
};
export async function browse(db,resource,user,{q='',category='',page=1,pageSize=12}={}){
 const sql=queries[resource];if(!sql)throw new Error('Unsupported browse resource.');
 const filter=browseFilters[resource] ? ` AND ($5 IN ('','all') OR (${browseFilters[resource]}))` : '';
 const organizer=!!user?.roles.includes('organizer'),finance=organizer||!!user?.roles.includes('treasurer');
 const {rows}=await db.query(`WITH access AS(SELECT $1::uuid uid,$2::boolean organizer,$3::boolean finance,$5::text category),
 filtered AS(SELECT * FROM (${sql}) x WHERE strpos(lower(search_text||' '||id::text),lower($4::text))>0${filter}),
 paged AS(SELECT * FROM filtered ORDER BY sort_key DESC,id ASC LIMIT $6 OFFSET $7)
 SELECT (SELECT count(*)::int FROM filtered) total,
 COALESCE((SELECT jsonb_agg(to_jsonb(p)-'search_text'-'sort_key' ORDER BY sort_key DESC,id ASC) FROM paged p),'[]'::jsonb) data`,
 [user?.id||null,organizer,finance,q,category,pageSize,(page-1)*pageSize]);
 return {data:rows[0].data,pagination:{page,pageSize,total:rows[0].total}};
}
export async function search(db,user,{q='',page=1,pageSize=12,category=''}={}){
 // Global results intentionally omit ticket admission codes, receipts, payment evidence and mail.
 const sql=`SELECT e.id,e.starts_at sort_key,e.title, e.venue summary,'events' kind,'/events/'||e.id href FROM events e WHERE e.status='published'
 UNION ALL SELECT p.id,p.created_at,p.name,p.category,'products','/shop/'||p.id FROM products p WHERE p.is_published
 UNION ALL SELECT n.id,n.created_at,n.title,left(n.body,180),'announcements','/announcements?q='||replace(n.id::text,' ','') FROM announcements n CROSS JOIN access a WHERE a.organizer OR(n.status='published' AND (n.audience='public' OR a.uid IS NOT NULL))
 UNION ALL SELECT o.id,o.created_at,'Order '||left(o.id::text,8),o.status,'orders','/orders/'||o.id FROM orders o CROSS JOIN access a WHERE o.user_id=a.uid
 UNION ALL SELECT t.id,t.created_at,t.title,t.status,'tasks','/tasks?q='||t.id FROM volunteer_tasks t CROSS JOIN access a WHERE t.assignee_id=a.uid OR a.organizer
 UNION ALL SELECT x.id,x.created_at,x.purpose,x.status,'expenses','/expenses?q='||x.id FROM expenses x CROSS JOIN access a WHERE x.requester_id=a.uid OR a.finance
 UNION ALL SELECT u.id,u.created_at,u.name,u.email,'members','/members?q='||u.id FROM users u CROSS JOIN access a WHERE a.organizer`;
 const org=!!user?.roles.includes('organizer'),finance=org||!!user?.roles.includes('treasurer');
 const {rows}=await db.query(`WITH access AS(SELECT $1::uuid uid,$2::boolean organizer,$3::boolean finance),
 filtered AS(SELECT * FROM (${sql}) x WHERE strpos(lower(title||' '||summary||' '||id::text),lower($4::text))>0 AND ($5::text='' OR kind=$5)),
 paged AS(SELECT * FROM filtered ORDER BY sort_key DESC,id,kind LIMIT $6 OFFSET $7)
 SELECT (SELECT count(*)::int FROM filtered) total,
 COALESCE((SELECT jsonb_agg(to_jsonb(p)-'sort_key' ORDER BY sort_key DESC,id,kind) FROM paged p),'[]'::jsonb) data`,
 [user?.id||null,org,finance,q,category,pageSize,(page-1)*pageSize]);
 return {data:rows[0].data,pagination:{page,pageSize,total:rows[0].total}};
}
