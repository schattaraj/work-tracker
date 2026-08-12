import { NextResponse } from 'next/server';
import { getSessionUser, getUsersSeeded, publicUser } from '../../../../lib/auth.js';
import { withApiError } from '../../../../lib/withApiError.js';

export const GET = withApiError(async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 });

  const usersData = await getUsersSeeded();
  const users = usersData.users
    .map(publicUser)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return NextResponse.json({ users });
});
