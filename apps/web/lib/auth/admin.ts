import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { adminAuditLogs, User } from '@/lib/db/schema';

export const PLATFORM_ADMIN_ROLES = ['admin', 'super_admin'] as const;

export function isPlatformAdmin(user: User | null): user is User {
  return (
    !!user &&
    user.status === 'active' &&
    PLATFORM_ADMIN_ROLES.includes(user.role as (typeof PLATFORM_ADMIN_ROLES)[number])
  );
}

export function isSuperAdmin(user: User | null): user is User {
  return !!user && user.status === 'active' && user.role === 'super_admin';
}

export async function requirePlatformAdmin(): Promise<User> {
  const user = await getUser();
  if (!isPlatformAdmin(user)) {
    redirect('/dashboard');
  }
  return user;
}

export async function requireSuperAdmin(): Promise<User> {
  const user = await getUser();
  if (!isSuperAdmin(user)) {
    redirect('/admin');
  }
  return user;
}

export async function requirePlatformAdminForApi() {
  const user = await getUser();
  if (!isPlatformAdmin(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return user;
}

export async function writeAdminAuditLog({
  adminUserId,
  action,
  targetType,
  targetId,
  metadata
}: {
  adminUserId: number;
  action: string;
  targetType: string;
  targetId?: number | null;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(adminAuditLogs).values({
    adminUserId,
    action,
    targetType,
    targetId: targetId ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null
  });
}
