export const money=(minor,currency)=>new Intl.NumberFormat('en-IN',{style:'currency',currency}).format(minor/100);
export const date=value=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(value))+' UTC':'—';
export const shortOrderId=(id)=>{
  if (!id) return '';
  if (typeof id === 'string' && id.startsWith('80000000-0000-0000-0000-')) {
    return id.split('-').pop().slice(-4);
  }
  return typeof id === 'string' ? id.slice(0, 8) : id;
};
