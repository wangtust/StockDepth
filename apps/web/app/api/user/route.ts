import { getPublicUser } from '@/lib/db/queries';

export async function GET() {
  const user = await getPublicUser();
  return Response.json(user);
}
