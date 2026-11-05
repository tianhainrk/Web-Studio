export const VN_OFFSET_MS=7*60*60*1000;
export function vnDate(iso){
  const t=Date.parse(iso);
  if(!Number.isFinite(t))throw Error("Thời gian không hợp lệ");
  return new Date(t+VN_OFFSET_MS).toISOString().slice(0,10);
}
export function vnMinutes(iso){
  const t=Date.parse(iso);
  if(!Number.isFinite(t))throw Error("Thời gian không hợp lệ");
  const d=new Date(t+VN_OFFSET_MS);
  return d.getUTCHours()*60+d.getUTCMinutes();
}
export function balancedCounts(count,minDaily=10){
  const n=Number(count);
  if(!Number.isInteger(n)||n<1||n>300)throw Error("Số tập phải từ 1 đến 300");
  const days=Math.max(1,Math.floor(n/minDaily));
  const base=Math.floor(n/days),extra=n%days;
  return Array.from({length:days},(_,i)=>base+(i<extra?1:0));
}
export function balancedSchedule({startDate,count}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate||"")))throw Error("Ngày bắt đầu không hợp lệ");
  const base=Date.parse(startDate+"T00:00:00+07:00");
  if(!Number.isFinite(base)||vnDate(new Date(base).toISOString())!==startDate)throw Error("Ngày bắt đầu không hợp lệ");
  const perDay=balancedCounts(count);
  const result=[];
  for(let d=0;d<perDay.length;d++){
    const n=perDay[d];
    for(let j=0;j<n;j++){
      // Starting hypothesis only. Muse may choose a more suitable time on the same
      // Vietnam-local day, based on permitted Page insights if available.
      const common=[435,540,690,750,840,990,1080,1170,1245,1320]; // 07:15 ... 22:00
      const minutes=n===10?common[j]:Math.round(420+j*930/Math.max(1,n-1));
      result.push(new Date(base+d*86400000+minutes*60000).toISOString());
    }
  }
  return result;
}
export function normalizeBalancedReply(rows,refs,{startDate,now=Date.now()}={}){
  if(!Array.isArray(rows)||!Array.isArray(refs)||!rows.length||rows.length!==refs.length)
    throw Error("Số tập trong kết quả AI không khớp");
  const numbers=refs.map(x=>Number(x.episode));
  if(numbers.some((n,i)=>!Number.isInteger(n)||(i&&n<=numbers[i-1])))throw Error("Manifest tập không hợp lệ");
  const baseline=balancedSchedule({startDate,count:refs.length});
  const output=[];let adjusted=0;
  for(let i=0;i<rows.length;i++){
    if(Number(rows[i].episode)!==numbers[i])throw Error("JSON trả sai số tập hoặc thứ tự tại vị trí "+(i+1));
    if(!String(rows[i].caption||"").trim()||String(rows[i].caption).length>2200)
      throw Error("Thiếu caption hợp lệ cho EP"+numbers[i]);
  }
  // Preserve the AI's decisions when an entire day's sequence is safe.
  // If any time is invalid, fall back to a consistent full-day baseline
  // rather than producing overlapping slots in a partially repaired day.
  let groupStart=0;
  while(groupStart<rows.length){
    const day=vnDate(baseline[groupStart]);
    let groupEnd=groupStart+1;
    while(groupEnd<rows.length&&vnDate(baseline[groupEnd])===day)groupEnd++;
    let valid=true,previous=-Infinity;
    for(let i=groupStart;i<groupEnd;i++){
      const raw=String(rows[i].scheduledAt||"");
      const t=Date.parse(raw);
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
        ||!Number.isFinite(t)||t<=now+60000||vnDate(raw)!==day||vnMinutes(raw)<420||vnMinutes(raw)>1380||t-previous<15*60000){
        valid=false;break;
      }
      previous=t;
    }
    for(let i=groupStart;i<groupEnd;i++){
      const scheduledAt=valid?new Date(rows[i].scheduledAt).toISOString():baseline[i];
      if(scheduledAt!==rows[i].scheduledAt)adjusted++;
      output.push({episode:numbers[i],scheduledAt,caption:String(rows[i].caption).trim()});
    }
    groupStart=groupEnd;
  }
  validateBalancedSchedule(output,startDate,now);
  return {plan:output,adjusted};
}
export function validateBalancedSchedule(plan,startDate,now=Date.now()){
  if(!Array.isArray(plan)||!plan.length)throw Error("Chiến dịch không có tập");
  const expected=balancedSchedule({startDate,count:plan.length});
  let prev=-Infinity;
  for(let i=0;i<plan.length;i++){
    const iso=String(plan[i].scheduledAt||"");
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(iso))throw Error("Lịch tập "+plan[i].episode+" không có múi giờ hợp lệ");
    const t=Date.parse(iso),minute=vnMinutes(iso);
    if(!Number.isFinite(t)||t<=now+60000||t>now+366*86400000)throw Error("Lịch đăng phải từ 1 phút đến 366 ngày tới");
    if(vnDate(iso)!==vnDate(expected[i]))throw Error("Số tập/ngày chưa cân bằng tại EP"+plan[i].episode);
    if(minute<420||minute>1380)throw Error("Giờ đăng phải từ 07:00 đến 23:00 (Việt Nam)");
    if(t-prev<15*60000)throw Error("Cần cách ít nhất 15 phút giữa hai bài đăng");
    prev=t;
  }
  return balancedCounts(plan.length);
}
export function daySummary(plan){
  const map=new Map();
  for(const j of plan||[]){
    const day=vnDate(j.scheduledAt),arr=map.get(day)||[];
    arr.push(j);map.set(day,arr);
  }
  return [...map].sort((a,b)=>a[0].localeCompare(b[0])).map(([day,items])=>({
    date:day,count:items.length,first:items[0]?.scheduledAt,last:items[items.length-1]?.scheduledAt
  }));
}
