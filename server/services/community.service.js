import { transaction } from '../utils/transaction.js';
// @flow:RENEWAL_REMINDERS — explicit consent, one reminder per period/window, local preview only.
export async function runReminders(pool,days=14) {
 if(!Number.isInteger(days)||days<1||days>90) throw new Error('Reminder days must be between 1 and 90.');
 return transaction(pool,async db=>{
 const result=await db.query(`INSERT INTO message_outbox(user_id,source_key,subject,body)
 SELECT mp.user_id,'renewal:'||mp.id||':'||CASE WHEN mp.expires_at<=now() THEN 'expired' ELSE 'upcoming' END,
 'Membership renewal reminder','Your membership expires at '||mp.expires_at::text||'. Visit the Membership page to review your status and renew.'
 FROM membership_periods mp JOIN mail_preferences p ON p.user_id=mp.user_id AND p.subscribed
 WHERE mp.expires_at BETWEEN now()-interval '30 days' AND now()+($1*interval '1 day')
 AND NOT EXISTS(SELECT 1 FROM membership_periods newer WHERE newer.user_id=mp.user_id AND newer.expires_at>mp.expires_at)
 ON CONFLICT(user_id,source_key) DO NOTHING RETURNING id`,[days]);
 return {queued:result.rowCount};
 });
}
// @rule:PREVIEW_NOT_SENT — no external delivery is claimed or performed.
export async function previewMail(pool) {
 return transaction(pool,async db=>{
 const result=await db.query(`WITH batch AS (
 SELECT id FROM message_outbox WHERE status='queued' ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)
 UPDATE message_outbox o SET status=CASE WHEN EXISTS(
 SELECT 1 FROM mail_preferences p WHERE p.user_id=o.user_id AND p.subscribed) THEN 'previewed' ELSE 'suppressed' END,
 processed_at=now() FROM batch WHERE o.id=batch.id RETURNING o.id`);
 return {processed:result.rowCount,mode:'local_preview'};
 });
}
