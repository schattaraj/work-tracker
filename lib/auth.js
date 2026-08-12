// ============================================================================
// Node-only auth helpers: password hashing, user lookups, and the seeded
// admin account. Builds on the Edge-safe primitives in lib/session.js.
// Import this file only from API routes / server components — NOT from
// middleware.js (see lib/session.js for why).
// ============================================================================

import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { readUsers, writeUsers } from './store.js';
import { SESSION_COOKIE, verifySession, sessionCookieOptions, signSession } from './session.js';

export { SESSION_COOKIE, sessionCookieOptions, signSession };

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Ensures at least one account exists. On a completely fresh deployment this
// creates the built-in admin from ADMIN_EMAIL / ADMIN_PASSWORD so there is
// always someone able to approve the first real users.
export async function getUsersSeeded() {
  const data = await readUsers();
  if (!data.users || data.users.length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@devtrack.local').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const admin = {
      id: 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: 'Admin',
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
      status: 'active',
      createdAt: new Date().toISOString()
    };
    data.users = [admin];
    await writeUsers(data);
  }
  return data;
}

export function findUserByEmail(usersData, email) {
  const needle = (email || '').trim().toLowerCase();
  return usersData.users.find(u => u.email.toLowerCase() === needle);
}

export function findUserById(usersData, id) {
  return usersData.users.find(u => u.id === id);
}

// Strips the password hash before a user record is ever sent to the client.
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

// Authoritative "who is calling, and are they currently allowed in" check for
// API route handlers. Re-reads users.json every call (rather than trusting
// only the JWT) so an admin suspending someone takes effect immediately,
// not just after their session token expires.
export async function getSessionUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  const usersData = await readUsers();
  const user = findUserById(usersData, session.uid);
  if (!user || user.status !== 'active') return null;
  return user;
}
