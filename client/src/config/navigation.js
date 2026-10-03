// @edit:NAVBAR_LINKS — UI visibility is not authorization; server checks every protected request.
export const navigation={
  public:[{label:'Shop',href:'/shop'},{label:'Events',href:'/events'},{label:'Overview',href:'/'},{label:'Modules',href:'/#modules'},{label:'Team',href:'/#team'}],
  member:[{label:'Shop',href:'/shop'},{label:'My orders',href:'/orders'},{label:'Events',href:'/events'},{label:'My membership',href:'/membership'},{label:'My tickets',href:'/tickets'}],
  staff:[{label:'Manage events',href:'/organizer/events'},{label:'Members',href:'/members'},{label:'Check-in',href:'/staff/checkin'},{label:'Payments',href:'/staff/payments'}],
};
