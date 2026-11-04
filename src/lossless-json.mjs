/**
 * JSON.parse rounds integers above 2^53-1. PineDrama uses int64 IDs.
 * Preserve otherwise-unsafe JSON integer tokens as strings, without touching
 * numbers inside JSON strings or altering normal numeric fields.
 * All input is still verified by JSON.parse after transformation.
 */
const LIMIT=BigInt(Number.MAX_SAFE_INTEGER);
export function parseLosslessJSON(input){
  const raw=typeof input==="string"?input:new TextDecoder("utf-8",{fatal:true}).decode(input);
  let result="";
  for(let i=0;i<raw.length;){
    const c=raw[i];
    if(c==='"'){
      const start=i++;
      let closed=false;
      while(i<raw.length){
        if(raw[i]==="\\"){i+=2;continue;}
        if(raw[i++]==='"'){closed=true;break;}
      }
      result+=raw.slice(start,i);
      if(!closed)break;
      continue;
    }
    if(c==="-"||(c>="0"&&c<="9")){
      const start=i;
      if(raw[i]==="-")i++;
      while(i<raw.length&&raw[i]>="0"&&raw[i]<="9")i++;
      const intEnd=i;
      if(raw[i]==="."){
        i++;
        while(i<raw.length&&raw[i]>="0"&&raw[i]<="9")i++;
      }
      if(raw[i]==="e"||raw[i]==="E"){
        i++;if(raw[i]==="+"||raw[i]==="-")i++;
        while(i<raw.length&&raw[i]>="0"&&raw[i]<="9")i++;
      }
      const literal=raw.slice(start,i);
      if(i===intEnd&&/^-?(0|[1-9]\d*)$/.test(literal)
          &&literal.length>15&&((BigInt(literal)<-LIMIT)||(BigInt(literal)>LIMIT))){
        result+=JSON.stringify(literal);
      }else result+=literal;
      continue;
    }
    result+=c;i++;
  }
  return JSON.parse(result);
}
