export function normalizeTicker(input: string) {
  const ticker = input.trim().toUpperCase();

  if (/^\d{6}\.SH$/.test(ticker)) {
    return ticker.replace(/\.SH$/, '.SS');
  }

  return ticker;
}
