// @edit:NAVBAR_LINKS — UI visibility is not authorization; server checks every protected request.
export const navigation={
  public:[{label:'Events',href:'/events'},{label:'Overview',href:'/'},{label:'Modules',href:'/#modules'},{label:'Team',href:'/#team'}],
  member:[{label:'Events',href:'/events'},{label:'My membership',href:'/membership'},{label:'My tickets',href:'/tickets'},{label:'My orders',planned:true}],
  staff:[{label:'Manage events',href:'/organizer/events'},{label:'Members',href:'/members'},{label:'Check-in',planned:true},{label:'Finance',planned:true}],
};
