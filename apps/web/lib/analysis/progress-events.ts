export type ProgressTool = { name: string; args: string; result?: string };
export type ProgressTurn = { id: number; text: string; tools: ProgressTool[]; result?: string };

const labels: Record<string, string> = {
  get_stock_data: '查询股票行情', get_indicators: '计算技术指标',
  get_news: '检索公司新闻', get_global_news: '检索市场新闻',
  get_fundamentals: '查询公司基本面', get_income_statement: '查询利润表',
  get_balance_sheet: '查询资产负债表', get_cashflow: '查询现金流',
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
      const text = body.replace(/调用工具：([^\n]+)\s*\n```json\s*\n([\s\S]*?)\n```/g, (_, name, args) => {
        tools.push({ name: name.trim(), args: args.trim() }); return '';
      }).trim();
      turns.push({ id: index, text, tools });
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
  if (!result.trim()) return '返回为空';
  if (/^(error|exception|failed|错误|失败)/im.test(result)) return '返回包含错误信息，请展开查看';
  const lines = result.split('\n').filter(line => line.trim());
  return `${lines.length} 行数据 · ${result.length.toLocaleString()} 字符`;
}
