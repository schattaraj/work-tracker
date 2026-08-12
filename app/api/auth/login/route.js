import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getUsersSeeded, findUserByEmail, verifyPassword, signSession,
  SESSION_COOKIE, sessionCookieOptions, publicUser
} from '../../../../lib/auth.js';

const STATUS_MESSAGES = {
  pending: 'Your account is awaiting admin approval.',
  suspended: 'Your account has been suspended. Contact an admin.',
  rejected: 'Your registration was not approved.'
};

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const usersData = await getUsersSeeded();
  const user = findUserByEmail(usersData, email);

  // Generic message for both "no such user" and "wrong password" so login
  // can't be used to enumerate registered emails.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  if (user.status !== 'active') {
    return NextResponse.json({ error: STATUS_MESSAGES[user.status] || 'Your account is not active.' }, { status: 403 });
  }

  const token = await signSession({ uid: user.id, role: user.role });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());

  return NextResponse.json({ user: publicUser(user) });
}
