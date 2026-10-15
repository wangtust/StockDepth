'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {restoreModelAvailability} from '@/app/admin/actions';
import {Button} from '@/components/ui/button';
export function ModelAvailabilityButton({configId}:{configId:number}) {
  const router=useRouter();const [pending,setPending]=useState(false),[message,setMessage]=useState('');
  return <div className="space-y-2"><p className="text-sm text-amber-800">额度不足，已从分析模型选项中排除。充值或开启后付费后，可发送一次模型测试请求并恢复。</p>
    <Button type="button" variant="outline" disabled={pending} onClick={async()=>{setPending(true);setMessage('');try{const form=new FormData();form.set('configId',String(configId));const result=await restoreModelAvailability(form);setMessage(result.error||result.success||'测试失败');if(result.success)router.refresh();}catch{setMessage('测试未完成，请稍后重试。');}finally{setPending(false);}}}>{pending?'测试中…':'测试并恢复'}</Button>
    {message&&<p role="status" className="text-sm">{message}</p>}
  </div>;
}
