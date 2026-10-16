import {encryptModelKey} from '../security/model-key';
import type {LlmModelConfig} from '../db/schema';
export function immutableModelSnapshot(config:Pick<LlmModelConfig,'id'|'provider'|'baseUrl'|'modelName'|'modelOptions'|'apiKey'|'inputPrice'|'cachePrice'|'outputPrice'>) {
  try {
    const apiKey=config.apiKey.startsWith('sdkey:')?config.apiKey:encryptModelKey(config.apiKey);
    const options=config.modelOptions||{};
    if(options.request_concurrency!=null&&(!Number.isInteger(Number(options.request_concurrency))||Number(options.request_concurrency)<1))throw new Error();
    return JSON.stringify({...config,modelOptions:options,apiKey});
  }catch{throw new Error('模型密钥加密配置不可用，无法安全创建任务快照。');}
}
export function encryptedHistoricalSnapshot(value:string|null) {
  if(!value)return null;
  return immutableModelSnapshot(JSON.parse(value));
}
