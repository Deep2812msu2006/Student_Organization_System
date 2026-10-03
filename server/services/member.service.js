import { createMembership, getMemberProfile } from '../model/member.model.js';
import { getPlan, lockEnrollment, hasCurrentOrFuturePeriod } from '../model/enrollment.model.js';
import { transaction } from '../utils/transaction.js';
import { HttpError } from '../utils/httpError.js';

export function membershipExpiry(now, month, day) {
  let year = now.getUTCFullYear();
  let expiry = new Date(Date.UTC(year, month - 1, day + 1));
  if (expiry <= now) expiry = new Date(Date.UTC(++year, month - 1, day + 1));
  return expiry;
}
export async function enroll(pool,userId,planId,config) {
  return transaction(pool, async client => {
    const now = new Date();
    // @rule:ENROLLMENT_ONCE — serialize requests per user; repeat/overlap yields 409.
    await lockEnrollment(client,userId);
    if (await hasCurrentOrFuturePeriod(client,userId,now)) throw new HttpError(409,'MEMBERSHIP_EXISTS','You already have a current or upcoming membership period.');
    const plan = await getPlan(client,planId);
    if (!plan) throw new HttpError(404,'PLAN_NOT_FOUND','This membership plan is unavailable.');
    await createMembership(client,{ userId,planId,startsAt:now,
      expiresAt:membershipExpiry(now,config.membershipYearEndMonth,config.membershipYearEndDay),
      duesAmountMinor:plan.dues_amount_minor,currency:plan.currency });
    return getMemberProfile(client,userId,now);
  });
}
// @rule:MEMBER_DISCOUNT — the application role alone never grants financial benefits.
export function publicProfile(profile,plans) {
  const plan = plans.find(value => value.id === profile.planId);
  return { ...profile, benefits: {
    eligible: profile.membershipStatus === 'active',
    ticketDiscountPct: profile.membershipStatus === 'active' ? plan?.ticketDiscountPct || 0 : 0,
    merchDiscountPct: profile.membershipStatus === 'active' ? plan?.merchDiscountPct || 0 : 0,
  } };
}
