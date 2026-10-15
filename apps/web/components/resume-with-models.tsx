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
    <summary className="cursor-pointer text-sm font-medium text-amber-900">更换模型并继续</summary>
    <p className="mt-2 text-sm text-slate-600">保留已完成报告和历史用量，从检查点的未完成阶段继续；没有检查点时从头运行。无需再次扣分析额度，后续模型调用按新模型计价。</p>
    <form className="mt-3 space-y-3" onSubmit={async e=>{e.preventDefault();if(disabled||!selectedQuick||!selectedDeep)return;if(await onResume(jobId,{quickModelConfigId:selectedQuick,deepModelConfigId:selectedDeep}))setOpen(false);}}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span>继续任务的 Quick 模型</span><select aria-label="继续任务的 Quick 模型" className="block w-full rounded-md border bg-white p-2" value={selectedQuick??''} disabled={disabled} required onChange={e=>setQuick(Number(e.target.value))}>{!quickModels.length&&<option value="">暂无可用模型</option>}{quickModels.map(m=><option key={m.id} value={m.id}>{m.name} · {m.modelName}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>继续任务的 Deep 模型</span><select aria-label="继续任务的 Deep 模型" className="block w-full rounded-md border bg-white p-2" value={selectedDeep??''} disabled={disabled} required onChange={e=>setDeep(Number(e.target.value))}>{!deepModels.length&&<option value="">暂无可用模型</option>}{deepModels.map(m=><option key={m.id} value={m.id}>{m.name} · {m.modelName}</option>)}</select></label>
      </div>
      <Button type="submit" size="sm" disabled={disabled||!selectedQuick||!selectedDeep}>{disabled?'处理中…':'确认更换并继续'}</Button>
    </form>
  </details>;
}
