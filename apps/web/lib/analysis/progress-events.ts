export type ProgressTool = { name: string; args: string; result?: string };
export type ProgressTurn = { id: number; agent?: string; model?: string; text: string; tools: ProgressTool[]; result?: string };

const labels: Record<string, string> = {
  get_stock_data: 'Fetch stock prices', get_indicators: 'Calculate technical indicators',
  get_news: 'Search company news', get_global_news: 'Search market news',
  get_fundamentals: 'Fetch company fundamentals', get_income_statement: 'Fetch income statement',
  get_balance_sheet: 'Fetch balance sheet', get_cashflow: 'Fetch cash flow',
};
export function toolLabel(name: string) { return labels[name] || name; }

export function parseProgress(content: string): ProgressTurn[] {
  const headings = [...content.matchAll(/^## \d+\. (模型回复|工具结果：[^\n]+)\s*$/gm)];
  const turns: ProgressTurn[] = [];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const body = content.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? content.length).trim();
    if (heading[1] === '模型回复') {
      const tools: ProgressTool[] = [];
      const marker = body.match(/^<!-- stockdepth-interaction (.+?) -->\s*/);
      let identity: { agent?: string; model?: string } = {};
      if (marker) {
        try {
          const value = JSON.parse(marker[1]);
          if (typeof value.agent === 'string') identity.agent = value.agent;
          if (typeof value.model === 'string') identity.model = value.model;
        } catch { /* Old or malformed metadata must not break progress. */ }
      }

      const text = (marker ? body.slice(marker[0].length) : body).replace(/调用工具：([^\n]+)\s*\n```json\s*\n([\s\S]*?)\n```/g, (_, name, args) => {
        tools.push({ name: name.trim(), args: args.trim() }); return '';
      }).trim();
      turns.push({ id: index, ...identity, text, tools });
    } else {
      const name = heading[1].slice('工具结果：'.length).trim();
      const turn = [...turns].reverse().find(t => t.tools.some(tool => tool.name === name && tool.result === undefined));
      const tool = turn?.tools.find(tool => tool.name === name && tool.result === undefined);
      if (tool) tool.result = body;
      else turns.push({ id: index, text: '', tools: [{ name, args: '', result: body }] });
    }
  }
  return turns;
}

export function parameterSummary(args: string): string {
  try {
    const values = JSON.parse(args);
    return Object.entries(values).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(' · ');
  } catch { return args; }
}

export function resultSummary(result: string): string {
  if (!result.trim()) return 'Empty result';
  if (/^(error|exception|failed|错误|失败)/im.test(result)) return 'Result contains an error. Expand to view details.';
  const lines = result.split('\n').filter(line => line.trim());
  return `${lines.length} data ${lines.length === 1 ? 'line' : 'lines'} · ${result.length.toLocaleString('en-US')} characters`;
}
