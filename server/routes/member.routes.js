import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import Razorpay from 'razorpay';
import { verifyGatewayPayment } from '../services/gateway.service.js';
import { authController } from '../controllers/auth.controller.js';
import { requireUser, requireRole, requireCsrf } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { registrationSchema, loginSchema, membershipSchema, paginationSchema } from '../validators/auth.schema.js';
import { getMemberProfile, listMembers } from '../model/member.model.js';
import { listPlans } from '../model/enrollment.model.js';
import { enroll, publicProfile } from '../services/member.service.js';
import * as paymentModel from '../model/payment.model.js';
import { transaction } from '../utils/transaction.js';
import { HttpError } from '../utils/httpError.js';

export function memberRouter(pool,config) {
  const router = Router();
  const auth = authController(pool, config);
  const limit = rateLimit({ windowMs:15*60*1000, limit:20, standardHeaders:'draft-8', legacyHeaders:false,
    message:{error:{code:'RATE_LIMITED',message:'Too many sign-in attempts. Please try again later.'}} });
  const userAuth = requireUser(pool, config);
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/auth/csrf',auth.csrf);
  router.post('/auth/register',requireCsrf,limit,validate(registrationSchema),auth.register);
  router.post('/auth/login',requireCsrf,limit,validate(loginSchema),auth.login);
  router.post('/auth/logout',requireCsrf,auth.logout);
  router.get('/auth/me',userAuth,auth.me);
  router.get('/membership-plans',userAuth,async (_req,res) => res.json({data:await listPlans(pool),
    policy:{yearEndMonth:config.membershipYearEndMonth,yearEndDay:config.membershipYearEndDay,timeZone:'UTC',provisional:true}}));
  router.get('/members/me',userAuth,async (req,res) => res.json({data:publicProfile(await getMemberProfile(pool,req.user.id,new Date()),await listPlans(pool))}));
  router.get('/members',userAuth,requireRole('organizer'),validate(paginationSchema,'query'),async (req,res) => {
    const {rows,total}=await listMembers(pool,req.validated);
    res.json({data:rows,pagination:{...req.validated,total}});
  });
  router.post('/memberships',requireCsrf,userAuth,validate(membershipSchema),async (req,res) => {
    const profile=await enroll(pool,req.user.id,req.validated.planId,config);
    res.status(201).json({data:publicProfile(profile,await listPlans(pool))});
  });

  // POST /memberships/razorpay/order: Create Razorpay order for membership dues
  router.post('/memberships/razorpay/order', requireCsrf, userAuth, async (req, res) => {
    let profile = await getMemberProfile(pool, req.user.id, new Date());

    // If user provided planId and doesn't have an active or pending membership yet, enroll them first
    if (req.body?.planId && (!profile || ['none', 'expired'].includes(profile.membershipStatus))) {
      profile = await enroll(pool, req.user.id, req.body.planId, config);
    }

    if (!profile || !profile.duesObligationId) {
      throw new HttpError(400, 'NO_PENDING_DUES', 'No pending membership dues found.');
    }
    if (profile.duesStatus !== 'pending') {
      throw new HttpError(400, 'DUES_NOT_PENDING', `Cannot create payment for dues in ${profile.duesStatus} status.`);
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new HttpError(500, 'PAYMENT_CONFIG_MISSING', 'Razorpay credentials are not configured on server.');
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const receipt = `dues_${profile.duesObligationId.replace(/-/g, '').slice(0, 16)}`;
    const rzpOrder = await razorpay.orders.create({
      amount: profile.duesAmountMinor,
      currency: profile.currency || 'INR',
      receipt,
      notes: {
        duesObligationId: profile.duesObligationId,
        membershipPeriodId: profile.membershipPeriodId,
        userId: req.user.id,
        type: 'membership_dues',
      },
    });

    res.json({
      data: {
        razorpayOrderId: rzpOrder.id,
        amountMinor: rzpOrder.amount,
        currency: rzpOrder.currency,
        keyId,
        duesObligationId: profile.duesObligationId,
      },
    });
  });

  // POST /memberships/razorpay/verify: Verify Razorpay signature and confirm dues payment
  router.post('/memberships/razorpay/verify', requireCsrf, userAuth, async (req, res) => {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      throw new HttpError(400, 'INVALID_PAYMENT_DETAILS', 'Missing Razorpay payment verification fields.');
    }

    const pendingProfile = await getMemberProfile(pool, req.user.id, new Date());
    if (!pendingProfile?.duesObligationId) throw new HttpError(404, 'DUES_NOT_FOUND', 'Dues obligation not found.');
    await verifyGatewayPayment(req.body, {userId:req.user.id,targetField:'duesObligationId',targetId:pendingProfile.duesObligationId,amountMinor:pendingProfile.duesAmountMinor,currency:pendingProfile.currency});

    const updatedProfile = await transaction(pool, async client => {
      const profile = await getMemberProfile(client, req.user.id, new Date());
      if (!profile || !profile.duesObligationId) {
        throw new HttpError(404, 'DUES_NOT_FOUND', 'Dues obligation not found.');
      }

      const lockedDues = await paymentModel.lockDuesObligationForPayment(client, pendingProfile.duesObligationId);
      if (!lockedDues) {
        throw new HttpError(404, 'DUES_NOT_FOUND', 'Dues obligation not found.');
      }
      if (lockedDues.userId !== req.user.id) {
        throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to pay these dues.');
      }
      if (lockedDues.status === 'paid') {
        return publicProfile(await getMemberProfile(client, req.user.id, new Date()), await listPlans(client));
      }
      if (lockedDues.status !== 'pending') {
        throw new HttpError(409, 'DUES_NOT_PENDING', `Cannot confirm payment for dues in ${lockedDues.status} status.`);
      }

      await paymentModel.insertPaymentRecord(client, {
        duesObligationId: lockedDues.id,
        amountMinor: lockedDues.amountMinor,
        currency: lockedDues.currency,
        method: 'razorpay_upi',
        externalReference: razorpay_payment_id,
        notes: `Instant Razorpay Membership Dues Payment (ID: ${razorpay_payment_id})`,
        recordedBy: req.user.id,
        idempotencyKey: `rzp_dues_${razorpay_payment_id}`,
      });

      const confirmed = await paymentModel.confirmDuesPayment(client, {
        duesObligationId: lockedDues.id,
        paymentRef: `rzp:${razorpay_payment_id}`,
        paidAt: new Date().toISOString(),
      });
      if (!confirmed) {
        throw new HttpError(409, 'ALREADY_PAID', 'Dues obligation was already confirmed.');
      }

      return publicProfile(await getMemberProfile(client, req.user.id, new Date()), await listPlans(client));
    });

    res.json({
      data: updatedProfile,
      message: 'Payment verified successfully! Your membership is now active.',
    });
  });

  return router;
}
