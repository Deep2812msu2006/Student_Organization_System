// Bounded reads and parameterized writes. Callers own transactions.
export async function announcements(db, staff, signedIn) {
 return (await db.query(`SELECT id,title,body,audience,status,created_at AS "createdAt",published_at AS "publishedAt"
 FROM announcements WHERE $1 OR (status='published' AND (audience='public' OR $2))
 ORDER BY created_at DESC LIMIT 100`,[staff,signedIn])).rows;
}
export async function tasks(db,userId,staff) {
 return (await db.query(`SELECT t.id,t.title,t.description,t.status,t.due_at AS "dueAt",t.event_id AS "eventId",
 t.assignee_id AS "assigneeId",u.name AS "assigneeName"
 FROM volunteer_tasks t JOIN users u ON u.id=t.assignee_id WHERE $2 OR t.assignee_id=$1
 ORDER BY t.created_at DESC LIMIT 100`,[userId,staff])).rows;
}
export async function queueAnnouncement(db,item) {
 await db.query(`INSERT INTO message_outbox(user_id,source_key,subject,body)
 SELECT p.user_id,$1,$2,$3 FROM mail_preferences p WHERE p.subscribed
 ON CONFLICT(user_id,source_key) DO NOTHING`,['announcement:'+item.id,item.title,item.body]);
}
