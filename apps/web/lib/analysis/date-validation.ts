import {z} from 'zod';
export function isAnalysisDate(value:string) {
  return /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
// An analysis reference date may be a weekend; it need not be an exchange session.
export const analysisDateSchema=z.string().trim().refine(isAnalysisDate,'The analysis date must be a valid date in YYYY-MM-DD format.');
