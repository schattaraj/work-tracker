import { NextResponse } from 'next/server';
import { getSessionUser, getUsersSeeded, findUserById, publicUser } from '../../../../../lib/auth.js';
import { writeUsers } from '../../../../../lib/store.js';

const VALID_STATUSES = ['pending', 'active', 'rejected', 'suspended'];
const VALID_ROLES = ['admin', 'user'];

export async function PATCH(request, { params }) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (actor.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 });

  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const usersData = await getUsersSeeded();
  const target = findUserById(usersData, id);
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const nextStatus = body.status !== undefined ? body.status : target.status;
  const nextRole = body.role !== undefined ? body.role : target.role;
  if (!VALID_STATUSES.includes(nextStatus)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
  }
  if (!VALID_ROLES.includes(nextRole)) {
    return NextResponse.json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
  }

  // Guard against locking everyone out: never let this change remove the
  // last remaining active admin.
  const wasActiveAdmin = target.role === 'admin' && target.status === 'active';
  const willBeActiveAdmin = nextRole === 'admin' && nextStatus === 'active';
  if (wasActiveAdmin && !willBeActiveAdmin) {
    const otherActiveAdmins = usersData.users.filter(u => u.id !== target.id && u.role === 'admin' && u.status === 'active');
    if (otherActiveAdmins.length === 0) {
      return NextResponse.json({ error: 'Cannot remove the last active admin.' }, { status: 400 });
    }
  }

  target.status = nextStatus;
  target.role = nextRole;
  target.updatedAt = new Date().toISOString();
  await writeUsers(usersData);

  return NextResponse.json({ user: publicUser(target) });
}
