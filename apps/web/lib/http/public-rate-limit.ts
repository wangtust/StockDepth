// Bounded per-process abuse protection. Global cap also bounds spoofed IP traffic.
const buckets=new Map<string,{count:number;until:number}>();
let globalBucket={count:0,until:0};
export function publicRateLimited(request:Request) {
 const now=Date.now();
 if(now>=globalBucket.until){globalBucket={count:0,until:now+60000};buckets.clear();}
 if(++globalBucket.count>600)return true;
 const key=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0,80)||'anonymous';
 const bucket=buckets.get(key)||{count:0,until:globalBucket.until};
 buckets.set(key,bucket);return ++bucket.count>60;
}
