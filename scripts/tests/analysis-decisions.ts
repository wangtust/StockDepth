import assert from 'node:assert/strict';
import {extractDecision} from '../../apps/web/lib/analysis/decision-extraction';
for (const [text,action] of [
  ['**Rating**: Buy\n\n**Executive Summary**: Start a position.','buy'],
  ['**Rating**: SELL','sell'],['**Rating**: Hold','hold'],
  ['FINAL TRANSACTION PROPOSAL: **BUY**','buy'],['**最终评级**：持有','hold'],
  ['Buy now or sell later? Hold could be better.',null],
  ['**Rating**: Overweight\nFINAL TRANSACTION PROPOSAL: BUY',null],
  ['**Rating**: REVIEW\nOriginal assessment:\n**Rating**: Buy',null],
  ['**Rating**: Underweight','sell'],['评级：减持','sell'],['评级：低配','sell'],
  ['## 一、最终评级\n\n**Underweight（减持）**\n\n正文提及 Buy 或 Hold。','sell'],
  ['Rating: Underweight if prices drop',null],['Rating: Underweight\nRating: Hold',null],['Rating: Buy\nRating: Sell',null],
  ['Rating: BUY/HOLD/SELL',null],['Rating: Buy if price drops',null],['',null],
] as const) {
  const result=extractDecision(text);
  assert.equal(result.action,action,text);
  assert.equal(result.extractionStatus,action?'succeeded':'unrecognized');
}
assert.ok(extractDecision('**Rating**: Overweight\n**Executive Summary**: Gradually build.').summary?.includes('Overweight'));
console.log('PASS: explicit decisions, multilingual fields, ambiguous/conditional/conflicting ratings, five-level rating preservation.');
