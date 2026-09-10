export const CENTER = [20.984, -89.619];
export const AREA = [[20.75,-89.85],[21.25,-89.4]];
export const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function distance(a,b) {
 const rad = x=>x*Math.PI/180;
 const dlat=rad(b[0]-a[0]),dlng=rad(b[1]-a[1]);
 const h=Math.sin(dlat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dlng/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function inArea(lat,lng){return lat>=AREA[0][0]&&lat<=AREA[1][0]&&lng>=AREA[0][1]&&lng<=AREA[1][1];}
export function scheduledNow(schedule, date=new Date()) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Merida',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 const day=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(parts.weekday);
 const time=Number(parts.hour)*60+Number(parts.minute);
 return (schedule[day]||'').split(/\s+Y\s+/i).some(range=>{
  const m=range.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);if(!m)return false;
  return time>=Number(m[1])*60+Number(m[2])&&time<Number(m[3])*60+Number(m[4]);
 });
}
