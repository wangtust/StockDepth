export function normalizeTicker(input: string) {
  const ticker = input.trim().toUpperCase();

  if (/^\d{6}\.SH$/.test(ticker)) {
    return ticker.replace(/\.SH$/, '.SS');
  }

  const hk = ticker.match(/^(\d{1,5})\.HK$/);
  if (hk && Number(hk[1]) > 0) return `${hk[1].replace(/^0+(?=\d)/, '').padStart(4, '0')}.HK`;

  return ticker;
}
