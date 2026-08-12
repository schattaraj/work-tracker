// ============================================================================
// Edge-safe session primitives (JWT sign/verify via `jose`, which uses Web
// Crypto). Deliberately has NO dependency on lib/store.js or bcryptjs's
// Node internals, because this module is imported by middleware.js, which
// runs on the Edge runtime and cannot bundle Node built-ins like `fs`.
//
// lib/auth.js (Node-only, used by API routes) re-exports everything here and
// adds the heavier user-lookup / password-hashing helpers on top.
// ============================================================================

import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'devtrack_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET environment variable is not set. See .env.example.');
  }
  return new TextEncoder().encode(secret);
}

export async function signSession({ uid, role }) {
  return new SignJWT({ uid, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey());
}

// Returns the decoded payload ({ uid, role, iat, exp }) or null if the token
// is missing, malformed, or expired.
export async function verifySession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  };
}
