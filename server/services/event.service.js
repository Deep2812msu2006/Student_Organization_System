import * as model from '../model/event.model.js';
import {getMemberProfile} from '../model/member.model.js';
import {transaction} from '../utils/transaction.js';
import {HttpError} from '../utils/httpError.js';
import {hashToken,scopedKey,ticketToken} from '../utils/ticketToken.js';

export function validateDates(event){
  if(new Date(event.endsAt)<=new Date(event.startsAt))throw new HttpError(400,'INVALID_DATES','The end must be after the start.');
  if(new Date(event.startsAt)<=new Date())throw new HttpError(400,'EVENT_STARTED','Choose a future event start time.');
}
export async function detail(pool,id,userId,organizer=false){
  const event=await model.getEventById(pool,id);
  if(!event||(!organizer&&event.status!=='published'))throw new HttpError(404,'EVENT_NOT_FOUND','Event not found.');
  const profile=userId?await getMemberProfile(pool,userId,new Date()):null;
  // @rule:EVENT_MEMBER_PRICE — valid paid membership selects the event member price; no stacked discount.
  return {...event,eligiblePriceMinor:profile?.membershipStatus==='active'?event.memberPriceMinor:event.publicPriceMinor,
    memberPriceEligible:profile?.membershipStatus==='active',bookingOpen:event.status==='published'&&new Date(event.startsAt)>new Date()&&event.seatsAvailable>0};
}
export async function editEvent(pool,id,patch){
  return transaction(pool,async client=>{
    const current=await model.lockEventForBooking(client,id);
    if(!current)throw new HttpError(404,'EVENT_NOT_FOUND','Event not found.');
    const next={...current,...patch};validateDates(next);
    const allocated=await model.countAllocatedSeats(client,id);
    if(next.capacity<allocated)throw new HttpError(409,'CAPACITY_BELOW_ALLOCATED','Capacity cannot be lower than the reserved seats.');
    if(allocated&&(next.currency!==current.currency||next.status!==current.status))throw new HttpError(409,'EXISTING_REGISTRATIONS','Currency and publication status cannot change while seats are allocated; coordinate cancellations first.');
    // Registration price snapshots are never changed by this update.
    return model.updateEvent(client,id,next);
  });
}
function safeRegistration(row){const {tokenHash,idempotencyKey,userId,checkedInBy,...safe}=row;return safe;}
// @flow:EVENT_REGISTRATION — one client owns the event lock, pricing lookup and insertion.
export async function registerForEvent(pool,eventId,userId,key,secret){
  if(!secret)throw new HttpError(503,'TICKET_CONFIGURATION_REQUIRED','Ticket service configuration is incomplete.');
  const internalKey=scopedKey(userId,key);
  try{return await transaction(pool,async client=>{
    // Global per-user idempotency serialization also handles key reuse across different events.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[internalKey]);
    const previous=await model.findRegistrationByIdempotencyKey(client,internalKey);
    if(previous){
      if(previous.userId!==userId||previous.eventId!==eventId)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','This request key was already used for another registration.');
      return {registration:safeRegistration(previous),replayed:true};
    }
    const event=await model.lockEventForBooking(client,eventId);
    if(!event||event.status!=='published')throw new HttpError(404,'EVENT_NOT_FOUND','Event not found.');
    if(new Date(event.startsAt)<=new Date())throw new HttpError(409,'REGISTRATION_CLOSED','Registration has closed for this event.');
    // Uses Deep's @rule:EVENT_CAPACITY: pending and confirmed both reserve a seat.
    if(await model.countAllocatedSeats(client,eventId)>=event.capacity)throw new HttpError(409,'EVENT_FULL','This event has no seats remaining.');
    const profile=await getMemberProfile(client,userId,new Date());
    const priceMinor=profile?.membershipStatus==='active'?event.memberPriceMinor:event.publicPriceMinor;
    const token=ticketToken(secret,internalKey);
    const row=await model.insertRegistration(client,{eventId,userId,priceMinor,currency:event.currency,
      status:'pending',tokenHash:hashToken(token),idempotencyKey:internalKey});
    return {registration:safeRegistration(row),replayed:false};
  });}catch(error){
    if(error.code==='23505')throw new HttpError(409,'ALREADY_REGISTERED','You already have a reservation for this event. Open My Tickets.');
    throw error;
  }
}
export async function tickets(pool,userId,secret){
  const rows=await model.listUserTickets(pool,userId);
  const credentials=new Map((await model.ownedTicketCredentials(pool,userId)).map(value=>[value.id,value]));
  return rows.map(row=>{
    const credential=credentials.get(row.id);
    const token=secret&&credential?.idempotencyKey?ticketToken(secret,credential.idempotencyKey):null;
    const eligible=row.status==='confirmed'&&row.eventStatus==='published'&&!row.checkedInAt&&new Date(row.eventEndsAt)>new Date();
    const matches=token&&hashToken(token)===credential.tokenHash;
    return {...safeRegistration(row),admissionCode:eligible&&matches?token:null,
      codeStatus:row.checkedInAt?'used':!eligible?'not_eligible':matches?'ready':'reissue_required'};
  });
}
