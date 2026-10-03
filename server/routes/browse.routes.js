import {Router} from 'express';
import Joi from 'joi';
import {requireUser} from '../middleware/auth.middleware.js';
import {validate} from '../middleware/validate.middleware.js';
import {HttpError} from '../utils/httpError.js';
import {hashToken,ticketToken} from '../utils/ticketToken.js';
import {browse,search,publicResources,staffResources,financeResources,resourceNames} from '../model/browse.model.js';
const query=Joi.object({q:Joi.string().trim().allow('').max(120).default(''),category:Joi.string().trim().allow('').max(50).default(''),page:Joi.number().integer().min(1).max(100000).default(1),pageSize:Joi.number().integer().min(1).max(50).default(12)});
export function browseRouter(pool,config){
 const r=Router(),auth=requireUser(pool);
 const optionalAuth=(req,res,next)=>req.session.userId?auth(req,res,next):next();
 r.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 r.get('/search',optionalAuth,validate(query,'query'),async(req,res)=>res.json(await search(pool,req.user,req.validated)));
 r.get('/browse/:resource',optionalAuth,validate(query,'query'),async(req,res)=>{
 const kind=req.params.resource;
 if(!resourceNames.includes(kind))throw new HttpError(404,'NOT_FOUND','List not found.');
 if(!publicResources.has(kind)&&!req.user)throw new HttpError(401,'UNAUTHENTICATED','Please sign in.');
 if(staffResources.has(kind)&&!req.user?.roles.includes('organizer'))throw new HttpError(403,'FORBIDDEN','Organizer access required.');
 if(financeResources.has(kind)&&!req.user?.roles.some(r=>['organizer','treasurer'].includes(r)))throw new HttpError(403,'FORBIDDEN','Finance access required.');
 const result=await browse(pool,kind,req.user,req.validated);
 if(kind==='tickets')result.data=result.data.map(row=>{
 const {_hash,_key,...safe}=row;
 const code=config.ticketSecret&&_key?ticketToken(config.ticketSecret,_key):null;
 const eligible=row.status==='confirmed'&&row.eventStatus==='published'&&!row.checkedInAt&&new Date(row.eventEndsAt)>new Date();
 const matches=code&&hashToken(code)===_hash;
 return {...safe,admissionCode:eligible&&matches?code:null,codeStatus:row.checkedInAt?'used':!eligible?'not_eligible':matches?'ready':'reissue_required'};
 });
 res.json(result);
 });return r;
}
