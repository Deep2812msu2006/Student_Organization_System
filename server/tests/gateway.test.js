import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {verifyGatewayPayment} from '../services/gateway.service.js';
process.env.RAZORPAY_KEY_ID='rzp_test_synthetic';
process.env.RAZORPAY_KEY_SECRET='synthetic-test-secret';
const payload={razorpay_order_id:'order_test',razorpay_payment_id:'pay_test',razorpay_signature:crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update('order_test|pay_test').digest('hex')};
const expected={userId:'user1',targetField:'orderId',targetId:'purchase1',amountMinor:50000,currency:'INR'};
function gateway(order={},payment={}) {return {orders:{fetch:async()=>({id:'order_test',notes:{userId:'user1',orderId:'purchase1'},amount:50000,currency:'INR',...order})},payments:{fetch:async()=>({id:'pay_test',order_id:'order_test',amount:50000,currency:'INR',status:'captured',captured:true,amount_refunded:0,...payment})}};}
test('gateway accepts only matching captured payment',async()=>assert.equal((await verifyGatewayPayment(payload,expected,gateway())).id,'pay_test'));
for(const [name,order,payment] of [
 ['different purchase',{notes:{userId:'user1',orderId:'purchase2'}},{}],
 ['different owner',{notes:{userId:'other',orderId:'purchase1'}},{}],
 ['underpayment',{}, {amount:1}],
 ['wrong currency',{}, {currency:'USD'}],
 ['different provider order',{}, {order_id:'order_other'}],
 ['authorized only',{}, {status:'authorized',captured:false}],
 ['refunded payment',{}, {amount_refunded:100}],
 ['membership replay of merchandise',{notes:{userId:'user1',duesObligationId:'purchase1'}},{}]
])test('gateway rejects '+name,async()=>assert.rejects(verifyGatewayPayment(payload,expected,gateway(order,payment))));
test('gateway rejects forged and malformed signatures',async()=>{
 for(const sig of ['0'.repeat(64),{},'short'])await assert.rejects(verifyGatewayPayment({...payload,razorpay_signature:sig},expected,gateway()));
});
test('gateway fails closed when provider is unavailable',async()=>assert.rejects(verifyGatewayPayment(payload,expected,{orders:{fetch:async()=>{throw Error('offline')}},payments:{fetch:async()=>({})}}),{code:'PAYMENT_VERIFICATION_UNAVAILABLE'}));
