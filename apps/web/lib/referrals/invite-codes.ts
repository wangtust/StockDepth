import 'server-only';

import { randomInt } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const INVITE_CODE_LENGTH = 6;

export function normalizeInviteCode(value: string | null | undefined) {
  const code = (value || '').trim().toUpperCase();
  return code || null;
}

export function isValidInviteCode(value: string | null | undefined) {
  const code = normalizeInviteCode(value);
  return Boolean(code && /^[A-Z]{6}$/.test(code));
}

function randomInviteCode() {
  let code = '';
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

export async function generateUniqueInviteCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomInviteCode();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.inviteCode, code))
      .limit(1);

    if (!existing) {
      return code;
    }
  }

  throw new Error('Unable to generate a unique invite code.');
}

export async function ensureUserInviteCode(userId: number) {
  const [currentUser] = await db
    .select({ inviteCode: users.inviteCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (currentUser?.inviteCode) {
    return currentUser.inviteCode;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = await generateUniqueInviteCode();

    try {
      const [updatedUser] = await db
        .update(users)
        .set({ inviteCode: code, updatedAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.inviteCode)))
        .returning({ inviteCode: users.inviteCode });

      if (updatedUser?.inviteCode) {
        return updatedUser.inviteCode;
      }

      const [freshUser] = await db
        .select({ inviteCode: users.inviteCode })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (freshUser?.inviteCode) {
        return freshUser.inviteCode;
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== '23505') {
        throw error;
      }
    }
  }

  throw new Error('Unable to assign a unique invite code.');
}
