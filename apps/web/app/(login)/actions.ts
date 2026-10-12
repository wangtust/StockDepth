'use server';

import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  User,
  users,
  activityLogs,
  creditTransactions,
  type NewUser,
  type NewActivityLog,
  ActivityType
} from '@/lib/db/schema';
import { comparePasswords, hashPassword, setSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createCheckoutSession } from '@/lib/payments/stripe';
import { getUser } from '@/lib/db/queries';
import {
  validatedAction,
  validatedActionWithUser
} from '@/lib/auth/middleware';
import { isPlatformAdmin } from '@/lib/auth/admin';
import {
  generateUniqueInviteCode,
  isValidInviteCode,
  normalizeInviteCode
} from '@/lib/referrals/invite-codes';

async function logActivity(
  userId: number,
  type: ActivityType,
  ipAddress?: string
) {
  const newActivity: NewActivityLog = {
    userId,
    action: type,
    ipAddress: ipAddress || ''
  };
  await db.insert(activityLogs).values(newActivity);
}

const signInSchema = z.object({
  email: z.string().email().min(3).max(255),
  password: z.string().min(8).max(100)
});

export const signIn = validatedAction(signInSchema, async (data, formData) => {
  const { email, password } = data;

  const [foundUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!foundUser) {
    return {
      error: 'Invalid email or password. Please try again.',
      email,
      password
    };
  }

  if (foundUser.status !== 'active' || foundUser.deletedAt) {
    return {
      error: 'Invalid email or password. Please try again.',
      email,
      password
    };
  }

  const isPasswordValid = await comparePasswords(
    password,
    foundUser.passwordHash
  );

  if (!isPasswordValid) {
    return {
      error: 'Invalid email or password. Please try again.',
      email,
      password
    };
  }

  await Promise.all([
    setSession(foundUser),
    logActivity(foundUser.id, ActivityType.SIGN_IN)
  ]);

  const redirectTo = formData.get('redirect') as string | null;
  if (redirectTo === 'checkout') {
    const packId = String(formData.get('packId') || '');
    return createCheckoutSession({ user: foundUser, packId });
  }

  redirect(isPlatformAdmin(foundUser) ? '/admin' : '/dashboard');
});

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  inviteCode: z.string().optional()
});

export const signUp = validatedAction(signUpSchema, async (data, formData) => {
  const { email, password } = data;
  const referralCode = normalizeInviteCode(data.inviteCode);

  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser.length > 0) {
    return {
      error: 'Failed to create user. Please try again.',
      email,
      password
    };
  }

  if (referralCode && !isValidInviteCode(referralCode)) {
    return {
      error: 'Invite code must be six letters.',
      email,
      password
    };
  }

  const referrer = referralCode
    ? (
        await db
          .select({
            id: users.id
          })
          .from(users)
          .where(
            and(
              eq(users.inviteCode, referralCode),
              eq(users.status, 'active'),
              isNull(users.deletedAt)
            )
          )
          .limit(1)
      )[0]
    : null;

  if (referralCode && !referrer) {
    return {
      error: 'Invalid invite code.',
      email,
      password
    };
  }

  const passwordHash = await hashPassword(password);
  const inviteCode = await generateUniqueInviteCode();

  const newUser: NewUser = {
    email,
    passwordHash,
    inviteCode,
    role: 'member'
  };

  let createdUser: User;

  try {
    ({ createdUser } = await db.transaction(async (tx) => {
      const [createdUser] = await tx.insert(users).values(newUser).returning();

      if (!createdUser) {
        throw new Error('Failed to create user.');
      }

      await tx.insert(activityLogs).values({
        userId: createdUser.id,
        action: ActivityType.SIGN_UP,
        ipAddress: ''
      });

      if (referrer?.id) {
        await tx
          .update(users)
          .set({
            analysisCredits: sql`${users.analysisCredits} + 5`,
            updatedAt: new Date()
          })
          .where(eq(users.id, referrer.id));

        await tx.insert(creditTransactions).values({
          userId: referrer.id,
          amount: 5,
          reason: 'invite_code_reward'
        });

        await tx.insert(activityLogs).values({
          userId: referrer.id,
          action: ActivityType.INVITE_CODE_REWARD,
          ipAddress: ''
        });
      }

      return { createdUser };
    }));
  } catch (error) {
    console.error('Failed to create user account.', error);
    return {
      error: 'Failed to create user. Please try again.',
      email,
      password
    };
  }

  await setSession(createdUser);

  const redirectTo = formData.get('redirect') as string | null;
  if (redirectTo === 'checkout') {
    const packId = String(formData.get('packId') || '');
    return createCheckoutSession({ user: createdUser, packId });
  }

  redirect('/dashboard');
});

export async function signOut() {
  const user = (await getUser()) as User;
  await logActivity(user.id, ActivityType.SIGN_OUT);
  (await cookies()).delete('session');
}

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(100),
  newPassword: z.string().min(8).max(100),
  confirmPassword: z.string().min(8).max(100)
});

export const updatePassword = validatedActionWithUser(
  updatePasswordSchema,
  async (data, _, user) => {
    const { currentPassword, newPassword, confirmPassword } = data;

    const isPasswordValid = await comparePasswords(
      currentPassword,
      user.passwordHash
    );

    if (!isPasswordValid) {
      return {
        currentPassword,
        newPassword,
        confirmPassword,
        error: 'Current password is incorrect.'
      };
    }

    if (currentPassword === newPassword) {
      return {
        currentPassword,
        newPassword,
        confirmPassword,
        error: 'New password must be different from the current password.'
      };
    }

    if (confirmPassword !== newPassword) {
      return {
        currentPassword,
        newPassword,
        confirmPassword,
        error: 'New password and confirmation password do not match.'
      };
    }

    const newPasswordHash = await hashPassword(newPassword);

    await Promise.all([
      db
        .update(users)
        .set({ passwordHash: newPasswordHash })
        .where(eq(users.id, user.id)),
      logActivity(user.id, ActivityType.UPDATE_PASSWORD)
    ]);

    return {
      success: 'Password updated successfully.'
    };
  }
);

const deleteAccountSchema = z.object({
  password: z.string().min(8).max(100)
});

export const deleteAccount = validatedActionWithUser(
  deleteAccountSchema,
  async (data, _, user) => {
    const { password } = data;

    const isPasswordValid = await comparePasswords(password, user.passwordHash);
    if (!isPasswordValid) {
      return {
        password,
        error: 'Incorrect password. Account deletion failed.'
      };
    }

    await logActivity(user.id, ActivityType.DELETE_ACCOUNT);

    // Soft delete
    await db
      .update(users)
      .set({
        deletedAt: sql`CURRENT_TIMESTAMP`,
        email: sql`CONCAT(email, '-', id, '-deleted')` // Ensure email uniqueness
      })
      .where(eq(users.id, user.id));

    (await cookies()).delete('session');
    redirect('/sign-in');
  }
);

const updateAccountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address')
});

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user) => {
    const { name, email } = data;

    await Promise.all([
      db.update(users).set({ name, email }).where(eq(users.id, user.id)),
      logActivity(user.id, ActivityType.UPDATE_ACCOUNT)
    ]);

    return { name, success: 'Account updated successfully.' };
  }
);
