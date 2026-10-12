import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  shouldUseSecureCookies,
  signToken,
  verifyToken
} from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

const protectedRoutes = ['/dashboard', '/admin'];
const adminRoles = ['admin', 'super_admin'];

async function getActiveUserRole(userId: number) {
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.status, 'active'),
        isNull(users.deletedAt)
      )
    )
    .limit(1);

  return user?.role ?? null;
}

function redirectWithSessionCookie(
  request: NextRequest,
  url: string,
  sessionValue?: string,
  expires?: Date
) {
  const response = NextResponse.redirect(new URL(url, request.url));
  if (sessionValue && expires) {
    response.cookies.set({
      name: 'session',
      value: sessionValue,
      httpOnly: true,
      secure: shouldUseSecureCookies(),
      sameSite: 'lax',
      expires
    });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get('session');
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );
  const isAdminRoute = pathname.startsWith('/admin');
  const isDashboardRoute = pathname.startsWith('/dashboard');
  const isAuthRoute = pathname === '/sign-in' || pathname === '/sign-up';

  if (isProtectedRoute && !sessionCookie) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }

  let res = NextResponse.next();

  if (sessionCookie && request.method === 'GET') {
    try {
      const parsed = await verifyToken(sessionCookie.value);
      const expiresInOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const renewedSession = await signToken({
        ...parsed,
        expires: expiresInOneDay.toISOString()
      });
      const role = await getActiveUserRole(parsed.user.id);

      if (!role) {
        res.cookies.delete('session');
        if (isProtectedRoute) {
          return NextResponse.redirect(new URL('/sign-in', request.url));
        }
        return res;
      }

      const isAdmin = adminRoles.includes(role);

      if (!isAdmin && isAdminRoute) {
        return redirectWithSessionCookie(request, '/dashboard', renewedSession, expiresInOneDay);
      }

      if (isAuthRoute) {
        return redirectWithSessionCookie(
          request,
          isAdmin ? '/admin' : '/dashboard',
          renewedSession,
          expiresInOneDay
        );
      }

      res.cookies.set({
        name: 'session',
        value: renewedSession,
        httpOnly: true,
        secure: shouldUseSecureCookies(),
        sameSite: 'lax',
        expires: expiresInOneDay
      });
    } catch (error) {
      console.error('Error updating session:', error);
      res.cookies.delete('session');
      if (isProtectedRoute) {
        return NextResponse.redirect(new URL('/sign-in', request.url));
      }
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs'
};
