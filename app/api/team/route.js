import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../lib/auth.js';
import { readUsers } from '../../../lib/store.js';

// Lightweight roster of active accounts, for the task-assignment dropdown.
// Any active user can see who they can assign work to — this is not an
// admin-only endpoint like /api/admin/users (which also exposes pending/
// suspended accounts and full management actions).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const usersData = await readUsers();
  const members = usersData.users
    .filter(u => u.status === 'active')
    .map(u => ({ id: u.id, name: u.name, email: u.email }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ members });
}
