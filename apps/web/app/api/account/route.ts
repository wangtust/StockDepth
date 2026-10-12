import { getAccountForUser } from '@/lib/db/queries';

export async function GET() {
  const account = await getAccountForUser();
  return Response.json(account);
}
