import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { requireUser, requireRole, requireCsrf } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { registrationSchema, loginSchema, membershipSchema, paginationSchema } from '../validators/auth.schema.js';
import { getMemberProfile, listMembers } from '../model/member.model.js';
import { listPlans } from '../model/enrollment.model.js';
import { enroll, publicProfile } from '../services/member.service.js';

export function memberRouter(pool,config) {
  const router = Router();
  const auth = authController(pool);
  const limit = rateLimit({ windowMs:15*60*1000, limit:20, standardHeaders:'draft-8', legacyHeaders:false,
    message:{error:{code:'RATE_LIMITED',message:'Too many sign-in attempts. Please try again later.'}} });
  const userAuth = requireUser(pool);
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
  return router;
}
