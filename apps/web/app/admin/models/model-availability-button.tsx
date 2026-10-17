'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {restoreModelAvailability} from '@/app/admin/actions';
import {Button} from '@/components/ui/button';
export function ModelAvailabilityButton({configId}:{configId:number}) {
  const router=useRouter();const [pending,setPending]=useState(false),[message,setMessage]=useState('');
  return <div className="space-y-2"><p className="text-sm text-amber-800">This model has insufficient quota and is excluded from analysis choices. Add funds or enable paid usage, then send a test request to restore availability.</p>
    <Button type="button" variant="outline" disabled={pending} onClick={async()=>{setPending(true);setMessage('');try{const form=new FormData();form.set('configId',String(configId));const result=await restoreModelAvailability(form);setMessage(result.error||result.success||'Test failed');if(result.success)router.refresh();}catch{setMessage('The test could not be completed. Try again later.');}finally{setPending(false);}}}>{pending?'Testing…':'Test and restore'}</Button>
    {message&&<p role="status" className="text-sm">{message}</p>}
  </div>;
}
