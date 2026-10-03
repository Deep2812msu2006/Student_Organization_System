// @edit:NAVBAR_LINKS — UI visibility is not authorization; server checks every protected request.
export const navigation={
  public:[{label:'Overview',href:'/'},{label:'Modules',href:'/#modules'},{label:'Team',href:'/#team'}],
  member:[{label:'My membership',href:'/membership'},{label:'My tickets',planned:true},{label:'My orders',planned:true}],
  staff:[{label:'Members',href:'/members'},{label:'Check-in',planned:true},{label:'Finance',planned:true}],
};
