import {createHash,createHmac} from 'node:crypto';

// Stable server secret allows owner-only redisplay without storing raw admission tokens.
// Dharmik hashes the exact displayed ASCII string with SHA-256 before model check-in.
export const hashToken=token=>createHash('sha256').update(token,'utf8').digest('hex');
export const scopedKey=(userId,key)=>hashToken(`${userId}:${key}`);
export function ticketToken(secret,key){return 'sky1_'+createHmac('sha256',secret).update(`ticket:v1:${key}`).digest('base64url');}
