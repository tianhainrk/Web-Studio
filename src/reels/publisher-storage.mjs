import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
const TABLES=new Set(["publisher_credentials","publisher_campaigns","publisher_posts"]);
export function storageReady(){return Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.PUBLISHER_ENCRYPTION_KEY);}
export function requireStorage(){
  if(!storageReady()){const e=Error("Thiếu cấu hình Supabase/khóa mã hóa");e.status=503;throw e;}
}
function key(){
  const k=Buffer.from(process.env.PUBLISHER_ENCRYPTION_KEY||"","base64");
  if(k.length!==32)throw Error("Khóa mã hóa cần đúng 32 byte base64");
  return k;
}
export function seal(value){
  const nonce=randomBytes(12),c=createCipheriv("aes-256-gcm",key(),nonce);
  const payload=Buffer.concat([c.update(JSON.stringify(value),"utf8"),c.final()]);
  return ["v1",nonce.toString("base64url"),c.getAuthTag().toString("base64url"),payload.toString("base64url")].join(".");
}
export function unseal(value){
  const [v,nonce,tag,payload]=String(value||"").split(".");
  if(v!=="v1"||!nonce||!tag||!payload)throw Error("Dữ liệu xác thực không hợp lệ");
  const d=createDecipheriv("aes-256-gcm",key(),Buffer.from(nonce,"base64url"));
  d.setAuthTag(Buffer.from(tag,"base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(payload,"base64url")),d.final()]).toString("utf8"));
}
export async function db(table,{method="GET",query={},data,prefer}={}){
  requireStorage();
  if(!TABLES.has(table))throw Error("Tên bảng không được phép");
  const origin=new URL(process.env.SUPABASE_URL);
  if(origin.protocol!=="https:"||origin.username||origin.password)throw Error("SUPABASE_URL không hợp lệ");
  const url=new URL("/rest/v1/"+table,origin);
  for(const [k,v] of Object.entries(query))if(v!=null)url.searchParams.set(k,String(v));
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers={apikey:secret,Authorization:"Bearer "+secret,"Content-Type":"application/json",Accept:"application/json"};
  if(prefer)headers.Prefer=prefer;
  const res=await fetch(url,{method,headers,redirect:"error",
    ...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(30000)});
  if(!res.ok){
    const msg=(await res.text().catch(()=>"")).slice(0,200);
    const e=Error("Database HTTP "+res.status+": "+msg);
    e.status=res.status===409?409:502;throw e;
  }
  return res.status===204?[]:await res.json().catch(()=>[]);
}
export async function credential(id){
  const rows=await db("publisher_credentials",{query:{id:"eq."+id,select:"id,provider,display_name,ciphertext,metadata"}});
  return rows[0]?{...rows[0],secret:unseal(rows[0].ciphertext)}:null;
}
export async function saveCredential(data){
  const row={id:data.id,provider:data.provider,display_name:data.displayName,
    ciphertext:seal(data.secret),metadata:data.metadata||{},updated_at:new Date().toISOString()};
  await db("publisher_credentials",{method:"POST",query:{on_conflict:"id"},data:row,
    prefer:"resolution=merge-duplicates,return=minimal"});
}
export async function listCredentials(provider){
  const query={select:"id,provider,display_name,metadata,updated_at",order:"updated_at.desc",limit:100};
  if(provider)query.provider="eq."+provider;
  return db("publisher_credentials",{query});
}
export async function removeCredential(id){
  return db("publisher_credentials",{method:"DELETE",query:{id:"eq."+id},prefer:"return=minimal"});
}
export async function listCampaigns(){
  return db("publisher_campaigns",{query:{select:"id,name,ai_provider,tone,status,created_at,updated_at",order:"created_at.desc",limit:60}});
}
export async function campaign(id){
  return (await db("publisher_campaigns",{query:{id:"eq."+id,select:"*"}}))[0]||null;
}
export async function getPost(id){
  return (await db("publisher_posts",{query:{id:"eq."+id,select:"*"}}))[0]||null;
}
export async function posts(campaignId){
  const all=[];
  for(let offset=0;offset<5000;offset+=500){
    const page=await db("publisher_posts",{query:{
      campaign_id:"eq."+campaignId,select:"*",order:"scheduled_at.asc,id.asc",
      limit:500,offset
    }});
    all.push(...page);
    if(page.length<500)break;
  }
  return all;
}
export async function patchPost(id,changes,extra={}){
  const rows=await db("publisher_posts",{method:"PATCH",query:{id:"eq."+id,...extra},
    data:{...changes,updated_at:new Date().toISOString()},prefer:"return=representation"});
  if(!rows.length){const e=Error("Tác vụ đã thay đổi, hãy tải lại");e.status=409;throw e;}
  return rows[0];
}
export async function insertCampaign(data,items){
  const created=await db("publisher_campaigns",{method:"POST",data:[data],prefer:"return=representation"});
  const id=created[0]?.id;
  if(!id)throw Error("Không tạo được chiến dịch");
  try{
    for(let offset=0;offset<items.length;offset+=80)
      await db("publisher_posts",{method:"POST",
        data:items.slice(offset,offset+80).map(x=>({...x,campaign_id:id})),
        prefer:"return=minimal"});
    return created[0];
  }catch(e){
    await db("publisher_campaigns",{method:"DELETE",query:{id:"eq."+id},prefer:"return=minimal"}).catch(()=>{});
    throw e;
  }
}
