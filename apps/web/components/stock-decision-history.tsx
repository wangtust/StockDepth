'use client';
import { useState } from 'react';
import useSWR from 'swr';
import dynamic from 'next/dynamic';
import { jsonFetcher } from '@/lib/http/json-fetcher';
const MarkdownRenderer = dynamic(() => import('@/components/markdown-renderer').then(m => m.MarkdownRenderer));
type Decision = {jobId:number;date:string;analysisDate:string;completedAt:string|null;model:string|null;action:string|null;summary:string|null;extractionStatus:string|null};
type History = {prices:{date:string;close:string}[];decisions:Decision[];source:string|null;currency:string|null;timezone:string|null};
const colors:Record<string,string>={buy:'#15803d',sell:'#dc2626',hold:'#a16207'};
function isoDay(date:Date) {return date.toISOString().slice(0,10);}
export function StockDecisionHistory({id}:{id:string}) {
  const [from,setFrom]=useState(()=>isoDay(new Date(Date.now()-365*86400000)));
  const [to,setTo]=useState(()=>isoDay(new Date()));
  const [basis,setBasis]=useState('analysis');
  const [filter,setFilter]=useState('all');
  const [selected,setSelected]=useState<number|null>(null);
  const valid=!!from&&!!to&&from<=to;
  const {data,error,isLoading,mutate}=useSWR<History>(valid?`/api/market/instruments/${id}/decisions?${new URLSearchParams({from,to,basis})}`:null,jsonFetcher,{refreshInterval:30000,shouldRetryOnError:false});
  const {data:report,error:reportError,isLoading:reportLoading}=useSWR<{report:{content:string;title:string}}>(selected?`/api/analysis/jobs/${selected}?report=decision`:null,jsonFetcher,{shouldRetryOnError:false});
  const prices=(data?.prices||[]).filter(p=>Number.isFinite(Number(p.close))&&Number(p.close)>0);
  const decisions=(data?.decisions||[]).filter(d=>filter==='all'||(filter==='unknown'?!d.action:d.action===filter));
  const min=prices.length?Math.min(...prices.map(p=>Number(p.close))):0;
  const max=prices.length?Math.max(...prices.map(p=>Number(p.close))):1;
  const pad=Math.max((max-min)*0.12,max*0.005);
  const lo=min-pad,hi=max+pad;
  const start=prices.length?Date.parse(prices[0].date):0,end=prices.length?Date.parse(prices.at(-1)!.date):1;
  const x=(date:string)=>70+(Date.parse(date)-start)/Math.max(end-start,86400000)*900;
  const maxStack=Math.max(1,...Object.values(decisions.reduce<Record<string,number>>((counts,d)=>{counts[d.date]=(counts[d.date]||0)+1;return counts;},{})));
  const plotBottom=285+maxStack*17;
  const y=(price:string)=>plotBottom-(Number(price)-lo)/(hi-lo)*240;
  const points=prices.map(p=>`${x(p.date)},${y(p.close)}`).join(' ');
  const mapped=decisions.map(d=> {
    // Only shift weekends to the immediately following Monday. Missing market
    // sessions stay unpriced instead of moving a signal across a data gap.
    let price=prices.find(p=>p.date===d.date);
    if (!price && [0,6].includes(new Date(`${d.date}T00:00:00Z`).getUTCDay())) {
      const next=new Date(`${d.date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate()+(next.getUTCDay()===6?2:1));
      price=prices.find(p=>p.date===isoDay(next));
    }
    return {...d,price};
  });
  const groups=new Map<string,typeof mapped>();
  for(const d of mapped) if(d.price&&d.action) groups.set(d.price.date,[...(groups.get(d.price.date)||[]),d]);
  return <section className="space-y-4 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Historical decisions</h2><button className="underline" onClick={()=>mutate()}>Refresh</button></div>
    <div className="flex flex-wrap gap-3">
      <label>From <input aria-label="From date" className="rounded border p-1" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label>To <input aria-label="To date" className="rounded border p-1" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
      <label>Date <select aria-label="Date basis" className="rounded border p-1" value={basis} onChange={e=>setBasis(e.target.value)}><option value="analysis">Analysis date</option><option value="generated">Report generated date</option></select></label>
      <label>Decision <select aria-label="Decision" className="rounded border p-1" value={filter} onChange={e=>setFilter(e.target.value)}>{['all','buy','sell','hold','unknown'].map(a=><option key={a} value={a}>{a.toUpperCase()}</option>)}</select></label>
    </div>
    {!valid&&<p role="alert">Choose a valid date range.</p>}
    {isLoading&&<p role="status">Loading decisions and prices…</p>}
    {error&&<p role="alert">Unable to load history. Choose a range within 10 years and retry.</p>}
    {data&&<>
      <p>{data.source||'No price source'} · Unadjusted close · {data.currency||'Currency unknown'} · Market dates: {data.timezone||'UTC'}. BUY ▲ · SELL ▼ · HOLD ●</p>
      <p className="text-slate-500">Markers show report recommendations at reference closing prices, not executed trades. Weekend reports use the following Monday when available; other missing sessions stay unpriced. Report generation time is shown below.</p>
      {!prices.length?<p>No daily prices in this range. Check the market sync status below.</p>:<div className="overflow-x-auto"><svg role="img" aria-label="Historical closing prices with analysis decision markers" viewBox={`0 0 1000 ${plotBottom+55}`} className="min-w-[650px] w-full">
        {[0,1,2,3,4].map(i=>{const value=lo+(hi-lo)*i/4;const py=plotBottom-i*60;return <g key={i}><line x1="70" x2="970" y1={py} y2={py} stroke="#e2e8f0"/><text x="60" y={py+4} textAnchor="end" fontSize="11">{value.toFixed(2)}</text></g>})}
        <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2"/>
        {prices.filter((_,i)=>i===0||i===prices.length-1||i%Math.max(1,Math.floor(prices.length/5))===0).map(p=><text key={p.date} x={x(p.date)} y={plotBottom+40} textAnchor="middle" fontSize="10">{p.date}</text>)}
        {[...groups].flatMap(([date,items])=>items.map((d,index)=>{const px=x(date),py=y(d.price!.close);const my=py-18-index*17;return <g key={d.jobId} role="button" tabIndex={0} aria-label={`${d.action} ${d.date}, report ${d.jobId}`} className="cursor-pointer" onClick={()=>setSelected(d.jobId)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(d.jobId);}}}>
          <title>{`${d.action?.toUpperCase()} · ${d.date} · ${d.price!.close} ${data.currency||''}\n${d.model||''}\n${d.summary||''}`}</title>
          <line x1={px} x2={px} y1={py} y2={my} stroke={colors[d.action!]} strokeDasharray="2 2"/>
          {d.action==='hold'?<circle cx={px} cy={my} r="6" fill={colors.hold}/>:<path d={d.action==='buy'?`M ${px} ${my-7} l -7 12 h 14 Z`:`M ${px} ${my+7} l -7 -12 h 14 Z`} fill={colors[d.action!]}/>}
        </g>}))}
      </svg></div>}
      <p>{data.decisions.length} reports · {data.decisions.filter(d=>!d.action).length} unrecognized / pending</p>
      {!mapped.length?<p>No matching completed analysis records.</p>:<div className="max-h-96 overflow-auto"><table className="w-full text-left text-xs [&_th]:p-2 [&_td]:p-2 [&_tr]:border-b"><thead><tr>{['Date','Decision','Reference close','Generated','Model','Report'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{mapped.map(d=><tr key={d.jobId}>
        <td>{d.date}{basis==='generated'&&<div>Analysis: {d.analysisDate}</div>}</td><td style={{color:colors[d.action||'']}}>{d.action?.toUpperCase()||(d.extractionStatus==='unrecognized'?'Unrecognized':'Pending')}<div className="max-w-xs text-slate-600">{d.summary}</div></td><td>{d.price?`${d.price.close} (${d.price.date})`:'Price unavailable'}</td><td>{d.completedAt?new Date(d.completedAt).toLocaleString('en-US'):'—'}</td><td>{d.model||'—'}</td><td><button className="underline" onClick={()=>setSelected(d.jobId)}>View #{d.jobId}</button></td>
      </tr>)}</tbody></table></div>}
    </>}
    {selected&&<div role="dialog" aria-modal="true" aria-label={`Decision report ${selected}`} className="fixed inset-0 z-50 overflow-auto bg-black/40 p-4" onClick={()=>setSelected(null)}><div className="mx-auto max-w-4xl space-y-4 rounded-xl bg-white p-6" onClick={e=>e.stopPropagation()}><button autoFocus className="rounded border px-3 py-1" onClick={()=>setSelected(null)} onKeyDown={e=>{if(e.key==='Escape')setSelected(null);}}>Close report #{selected}</button>{reportLoading&&<p>Loading report…</p>}{reportError&&<p role="alert">Report unavailable.</p>}{report&&<><h3>{report.report.title}</h3><MarkdownRenderer content={report.report.content}/></>}</div></div>}
  </section>;
}
