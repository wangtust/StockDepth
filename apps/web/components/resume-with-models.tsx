'use client';
import {useState} from 'react';
import {Button} from './ui/button';
export type ResumeModel={id:number;name:string;modelName:string;quickEnabled:boolean;deepEnabled:boolean};
export type ResumeSelection={quickModelConfigId:number;deepModelConfigId:number};
export function ResumeWithModels({jobId,models,quickId,deepId,disabled,onResume}:{jobId:number;models:ResumeModel[];quickId?:number|null;deepId?:number|null;disabled:boolean;onResume:(id:number,selection:ResumeSelection)=>Promise<boolean>}) {
  const [open,setOpen]=useState(false),[quick,setQuick]=useState<number|null>(quickId||null),[deep,setDeep]=useState<number|null>(deepId||null);
  const quickModels=models.filter(m=>m.quickEnabled),deepModels=models.filter(m=>m.deepEnabled);
  const candidateQuick=quick??quickId,candidateDeep=deep??deepId;
  const selectedQuick=quickModels.some(m=>m.id===candidateQuick)?candidateQuick:quickModels[0]?.id;
  const selectedDeep=deepModels.some(m=>m.id===candidateDeep)?candidateDeep:deepModels[0]?.id;
  return <details className="rounded-md border border-amber-200 bg-amber-50 p-3" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium text-amber-900">Change models and continue</summary>
    <p className="mt-2 text-sm text-slate-600">Completed reports and usage history are preserved. Continue unfinished stages from the checkpoint, or restart if no checkpoint exists. No additional analysis credits are deducted; subsequent model calls use the new model prices.</p>
    <form className="mt-3 space-y-3" onSubmit={async e=>{e.preventDefault();if(disabled||!selectedQuick||!selectedDeep)return;if(await onResume(jobId,{quickModelConfigId:selectedQuick,deepModelConfigId:selectedDeep}))setOpen(false);}}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span>Quick model for continuation</span><select aria-label="Quick model for continuation" className="block w-full rounded-md border bg-white p-2" value={selectedQuick??''} disabled={disabled} required onChange={e=>setQuick(Number(e.target.value))}>{!quickModels.length&&<option value="">No models available</option>}{quickModels.map(m=><option key={m.id} value={m.id}>{m.name} · {m.modelName}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>Deep model for continuation</span><select aria-label="Deep model for continuation" className="block w-full rounded-md border bg-white p-2" value={selectedDeep??''} disabled={disabled} required onChange={e=>setDeep(Number(e.target.value))}>{!deepModels.length&&<option value="">No models available</option>}{deepModels.map(m=><option key={m.id} value={m.id}>{m.name} · {m.modelName}</option>)}</select></label>
      </div>
      <Button type="submit" size="sm" disabled={disabled||!selectedQuick||!selectedDeep}>{disabled?'Processing…':'Confirm and continue'}</Button>
    </form>
  </details>;
}
