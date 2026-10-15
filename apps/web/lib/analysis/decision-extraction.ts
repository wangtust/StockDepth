// Only explicit final decision fields are accepted; prose mentions are not signals.
export function extractDecision(content: string) {
  const plain = content.replace(/\*\*/g, '').replace(/__/g, '');
  const ratings = [...plain.matchAll(/^\s*(?:#{1,6}\s*)?(?:Rating|评级|最终评级)\s*[:：]\s*([^\n]+)\s*$/gim)];
  // Some reports put the rating on the first non-empty line under a heading.
  ratings.push(...plain.matchAll(/^[ \t]*#{1,6}[ \t]*(?:[一二三四五六七八九十0-9]+[、.．][ \t]*)?(?:最终评级|评级|Rating)[ \t]*[:：]?[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*([^\n]+)$/gim));
  const proposals = [...plain.matchAll(/^\s*(?:FINAL TRANSACTION PROPOSAL|最终交易建议|最终交易决策|Action)\s*[:：]\s*([^\n]+)\s*$/gim)];
  const fields = ratings.length ? ratings : proposals;
  const mapping: Record<string, 'buy' | 'sell' | 'hold'> = {buy:'buy',sell:'sell',hold:'hold','买入':'buy','卖出':'sell','持有':'hold','观望':'hold',underweight:'sell','减持':'sell','低配':'sell'};
  const actions = fields.map(m => mapping[m[1].trim().toLowerCase()] || (/^(?:underweight|减持|低配)\s*[（(](?:减持|低配)(?:\s*[/／]\s*(?:减持|低配))?[）)]$/i.test(m[1].trim()) ? 'sell' : undefined));
  const action = actions.length && actions.every(a => a && a === actions[0]) ? actions[0] : null;
  const summary = plain.match(/(?:Executive Summary|执行摘要|决策摘要)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim().slice(0, 1200) || fields[0]?.[0]?.trim().slice(0,1200) || null;
  return {action, summary: ratings.length ? `${ratings[0][0].trim()}${summary ? `\n${summary}` : ''}` : summary, extractionStatus: action ? 'succeeded' : 'unrecognized', extractionVersion: 2};
}
