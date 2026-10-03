// @edit:NAVBAR_LINKS — labels, destinations, groups and role visibility live here.
export const navigation={
 public:[{label:'Events',href:'/events'},{label:'Shop',href:'/shop'},{label:'News',href:'/announcements'}],
 member:[
 {label:'Events',href:'/events',group:'primary'},{label:'Shop',href:'/shop',group:'primary'},
 {label:'Orders',href:'/orders',group:'account'},{label:'Membership',href:'/membership',group:'account'},{label:'Tickets',href:'/tickets',group:'account'},
 {label:'News',href:'/announcements',group:'community'},{label:'Tasks',href:'/tasks',group:'community'},
 {label:'Expenses',href:'/expenses',group:'community'},{label:'Mail',href:'/mail',group:'community'}],
 utility:[{label:'Search',href:'/search',icon:'⌕'},{label:'Cart',href:'/cart',cart:true}],
 staff:[{label:'Inventory',href:'/staff/inventory',roles:['organizer']},{label:'Manage events',href:'/organizer/events',roles:['organizer']},{label:'Members',href:'/members',roles:['organizer']},{label:'Check-in',href:'/staff/checkin',roles:['organizer']},{label:'Payments',href:'/staff/payments',roles:['organizer','treasurer']},{label:'Dues',href:'/staff/dues',roles:['organizer','treasurer']},{label:'Finance',href:'/finance',roles:['organizer','treasurer']},{label:'Reminders',href:'/staff/mail',roles:['organizer']}]
};
