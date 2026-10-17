import { presentError, type PresentedError } from './error-presentation';

export class AnalysisActionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

// Match known business errors; never expose arbitrary API bodies or tracebacks.
export function presentActionError(error: unknown, action: 'queue' | 'delete' | 'continue'): PresentedError {
  const status = error instanceof AnalysisActionError ? error.status : undefined;
  const evidence = error instanceof Error ? error.message : '';
  const title = {queue:'Could not queue analysis',delete:'Could not delete analysis',continue:'Could not continue analysis'}[action];
  let description = status ? `The server rejected this operation (HTTP ${status}).` : 'The operation could not be confirmed.';
  let nextStep = 'Refresh the job list to check its current state before trying again.';
  if (status === 401) { description = 'Your session has expired.'; nextStep = 'Sign in again before submitting another operation.'; }
  else if (status === 403) { description = 'Your account does not have permission for this operation.'; nextStep = 'Check your account permissions.'; }
  else if (status === 402) { description = 'There are not enough analysis credits for the selected depth.'; nextStep = 'Choose a lower depth or add credits.'; }
  else if (status === 400 && /模型|model|Quick|Deep/i.test(evidence)) { description = 'The selected Quick or Deep model is unavailable or does not support this role.'; nextStep = 'Refresh the model list and choose available Quick and Deep models.'; }
  else if (status === 400 && /日期|date/i.test(evidence)) { description = 'The analysis date is invalid.'; nextStep = 'Choose a valid analysis date.'; }
  else if (status === 409 && /Only failed analysis jobs/.test(evidence)) { description = 'This job is no longer in a failed state.'; nextStep = 'Refresh the job list; only failed jobs can be continued.'; }
  else if (status === 409 && /模型额度|model.*quota/i.test(evidence)) { description = 'The selected model has insufficient quota.'; nextStep = 'Use “Change models and continue” to choose another model, or contact an administrator.'; }
  else if (status === 409 && /模型不可用|model.*unavailable/i.test(evidence)) { description = 'The selected model is unavailable.'; nextStep = 'Use “Change models and continue” to choose another model, or contact an administrator.'; }
  else if (status === 404) { description = 'This job is no longer available.'; }
  else if (status === 429) { description = 'Too many requests were submitted.'; nextStep = 'Wait briefly before trying again.'; }
  else if (status === 503 && /密钥|credentials|encryption/i.test(evidence)) { description = 'The model configuration could not be used to continue this job.'; nextStep = 'Check the model credentials or choose another model.'; }
  else if (status === 400) { description = 'Some analysis settings are invalid.'; nextStep = 'Check the ticker, date, depth and model selections.'; }
  return { ...presentError(error,'request'), title, description: description + (status && !description.includes(`HTTP ${status}`) ? ` (HTTP ${status})` : ''), nextStep };
}
