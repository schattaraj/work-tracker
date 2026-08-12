import { NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from './lib/session.js';

// Paths reachable without a session.
const PUBLIC_PATHS = new Set([
  '/login.html', '/register.html',
  '/api/auth/login', '/api/auth/register', '/api/health',
  '/style.css', '/login.js', '/register.js', '/favicon.ico'
]);

export async function proxy(req) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  // This checks the JWT's validity/role claim only — a cheap, Edge-friendly
  // gate for page redirects. The API routes independently re-verify against
  // users.json on every request (see lib/auth.js#getSessionUser), which is
  // the authoritative check (e.g. it catches a just-suspended account
  // immediately, without waiting for the token to expire).
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login.html', req.url));
  }

  const isAdminPath = pathname === '/admin.html' || pathname.startsWith('/api/admin');
  if (isAdminPath && session.role !== 'admin') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/app.html', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/app.html',
    '/admin.html',
    '/script.js',
    '/admin.js',
    '/api/:path*'
  ]
};
