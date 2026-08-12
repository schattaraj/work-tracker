import { NextResponse } from 'next/server';
import { getUsersSeeded, findUserByEmail, hashPassword } from '../../../../lib/auth.js';
import { writeUsers } from '../../../../lib/store.js';
import { withApiError } from '../../../../lib/withApiError.js';

export const POST = withApiError(async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Name, email, and password are all required.' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const usersData = await getUsersSeeded();
  if (findUserByEmail(usersData, email)) {
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
  }

  const user = {
    id: 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    email,
    passwordHash: await hashPassword(password),
    role: 'user',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  usersData.users.push(user);
  await writeUsers(usersData);

  return NextResponse.json({
    message: 'Account created. An admin needs to approve it before you can log in.'
  }, { status: 201 });
});
