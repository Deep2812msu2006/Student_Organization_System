import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {readConfig} from '../../server/config/env.js';
import {ticketToken,hashToken} from '../../server/utils/ticketToken.js';
// Only exact synthetic fixtures are repaired. Never change real users' tickets or receipts.
function receiptPdf(label){
 const stream='BT /F1 18 Tf 40 750 Td (SYNTHETIC DEMO RECEIPT) Tj 0 -30 Td /F1 12 Tf ('+label+') Tj 0 -24 Td (No real payment or purchase.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream'];
 let result='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(result));result+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});
 const xref=Buffer.byteLength(result);result+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return result;
}
export async function seed(pool){
 const dir=fileURLToPath(new URL('../../server/storage/receipts/',import.meta.url));await fs.mkdir(dir,{recursive:true});
 for(let i=1;i<=4;i++){
 const id='60000000-0000-0000-0000-'+String(i).padStart(12,'0');
 const {rows}=await pool.query('SELECT requester_id,purpose FROM expenses WHERE id=$1',[id]);if(!rows[0])continue;
 const key='synthetic_demo_'+i+'.pdf';await fs.writeFile(dir+key,receiptPdf('Example expense '+i));
 await pool.query('INSERT INTO receipt_uploads(receipt_key,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[key,rows[0].requester_id]);
 await pool.query('UPDATE expenses SET receipt_key=$2 WHERE id=$1 AND receipt_key LIKE $3',[id,key,'receipts/2026/dev-%']);
 }
 const {ticketSecret}=readConfig();
 if(ticketSecret)for(const key of ['idemp_seed_reg_001','idemp_seed_reg_003']){
 await pool.query('UPDATE registrations SET token_hash=$2 WHERE idempotency_key=$1 AND user_id IN ($3,$4)',[key,hashToken(ticketToken(ticketSecret,key)),'10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003']);
 }
}
