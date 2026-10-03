export const money=(minor,currency)=>new Intl.NumberFormat('en-IN',{style:'currency',currency}).format(minor/100);
export const date=value=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(value))+' UTC':'—';
