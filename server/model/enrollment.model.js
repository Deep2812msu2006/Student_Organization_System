// Additive membership queries; existing profile/user models remain the shared interface.
export async function listPlans(db) {
  return (await db.query(`SELECT id,name,description,dues_amount_minor AS "duesAmountMinor",currency,
    ticket_discount_pct AS "ticketDiscountPct",merch_discount_pct AS "merchDiscountPct"
    FROM membership_plans WHERE is_active=true ORDER BY dues_amount_minor,id`)).rows;
}
export async function lockEnrollment(db,userId) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
}
export async function hasCurrentOrFuturePeriod(db,userId,at) {
  return (await db.query('SELECT id FROM membership_periods WHERE user_id=$1 AND expires_at>$2 LIMIT 1',[userId,at])).rowCount > 0;
}
export async function getPlan(db,planId) {
  return (await db.query('SELECT * FROM membership_plans WHERE id=$1 AND is_active=true FOR SHARE',[planId])).rows[0];
}
