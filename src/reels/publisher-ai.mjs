const TONES={natural:"Tự nhiên, rõ ràng",dramatic:"Hấp dẫn nhưng không bịa tình tiết",concise:"Ngắn gọn"};
function normalize(text){
  let value=String(text||"").trim();
  if(value.startsWith("~~~json"))value=value.slice(7).replace(/~~~$/,"").trim();
  let obj;
  try{obj=JSON.parse(value);}catch{const m=value.match(/\{[\s\S]*\}/);if(m)try{obj=JSON.parse(m[0]);}catch{}}
  if(!obj||typeof obj!=="object")throw Error("AI không trả JSON hợp lệ");
  const title=String(obj.title||"").trim().slice(0,150);
  const caption=String(obj.caption||"").trim().slice(0,1500);
  if(caption.length<5)throw Error("Caption AI trống hoặc quá ngắn");
  const hashtags=[...new Set((Array.isArray(obj.hashtags)?obj.hashtags:[]).slice(0,10)
    .map(x=>"#"+String(x).replace(/^#+/,"").replace(/[^\p{L}\p{N}_]/gu,""))
    .filter(x=>x.length>1))];
  return {title,caption,hashtags};
}
export function captionPrompt({movieTitle,episodeNumber,episodeDescription,genres,tone}){
  const number=Number(episodeNumber);
  if(!Number.isInteger(number)||number<1)throw Error("Số tập không hợp lệ");
  return [
    "Viết caption phim ngắn bằng tiếng Việt dựa trên thông tin được cung cấp.",
    "Chỉ đưa ra chi tiết có trong metadata, không bịa nhân vật, tình tiết, lời thoại hay cái kết.",
    "Không gắn link, không dùng nội dung lừa đảo, không hứa hẹn không có căn cứ.",
    "Phong cách: "+(TONES[tone]||TONES.natural),
    'Trả về đối tượng JSON {"title":"...","caption":"...","hashtags":["#..."]}.',
    "Dữ liệu: "+JSON.stringify({
      movieTitle:String(movieTitle||"").slice(0,150),
      episodeNumber:number,episodeDescription:String(episodeDescription||"").slice(0,1500),
      genres:String(genres||"").slice(0,250)
    })
  ].join("\n");
}
async function request(url,init){
  const res=await fetch(url,{...init,redirect:"error",signal:AbortSignal.timeout(45000)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error("AI HTTP "+res.status+": "+String(data.error?.message||data.message||"Unknown").slice(0,200));
  return data;
}
export function aiConfigured(provider){
  if(provider==="gemini")return Boolean(process.env.GEMINI_API_KEY);
  if(provider==="muse")return Boolean(process.env.MUSE_API_KEY);
  return false;
}
export async function generateCaption(provider,input){
  if(!["gemini","muse"].includes(provider))throw Error("Nhà cung cấp AI không hợp lệ");
  if(!aiConfigured(provider)){const e=Error("Thiếu khóa API "+provider);e.status=503;throw e;}
  const prompt=captionPrompt(input);
  if(provider==="gemini"){
    const model=process.env.GEMINI_MODEL||"gemini-2.5-flash-lite";
    if(!/^[A-Za-z0-9._-]+$/.test(model))throw Error("Gemini model không hợp lệ");
    const response=await request("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{
      method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":process.env.GEMINI_API_KEY},
      body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],
        generationConfig:{responseMimeType:"application/json",temperature:0.6,maxOutputTokens:900}})
    });
    return normalize(response.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"");
  }
  const model=process.env.MUSE_MODEL||"muse-spark-1.3";
  if(!/^[A-Za-z0-9._-]+$/.test(model))throw Error("Muse model không hợp lệ");
  const response=await request("https://api.meta.ai/v1/chat/completions",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+process.env.MUSE_API_KEY},
    body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:0.6,max_tokens:900})
  });
  return normalize(response.choices?.[0]?.message?.content||"");
}
