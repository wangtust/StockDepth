import { StockDetailClient } from '../stocks-client';
export default async function StockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StockDetailClient id={id} />;
}
