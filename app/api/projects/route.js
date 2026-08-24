import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../lib/auth.js';
import { readDb, writeDb, readUsers, incrementCounter, isProjectMember } from '../../../lib/store.js';
import { withApiError } from '../../../lib/withApiError.js';

// GET: every active user can list projects — scoped to their own
// memberships; admins see all. (Not admin-only — "view the projects they
// manage/belong to" applies to everyone, per Feature 2.)
export const GET = withApiError(async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = await readDb();
  const projects = user.role === 'admin'
    ? (db.projects || [])
    : (db.projects || []).filter(p => isProjectMember(p, user.id));
  return NextResponse.json({ projects });
});

// POST: admin-only. Validates assignedUserIds against real, currently-
// active accounts (never trusts the client's claim that an id is valid).
export const POST = withApiError(async function POST(request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Project name is required.' }, { status: 400 });
  const description = typeof body.description === 'string' ? body.description : '';
  const status = body.status === 'archived' ? 'archived' : 'active';

  let assignedUserIds = [];
  if (body.assignedUserIds !== undefined) {
    if (!Array.isArray(body.assignedUserIds)) {
      return NextResponse.json({ error: 'assignedUserIds must be an array of user ids.' }, { status: 400 });
    }
    const usersData = await readUsers();
    const activeIds = new Set(usersData.users.filter(u => u.status === 'active').map(u => u.id));
    const invalid = body.assignedUserIds.filter(id => !activeIds.has(id));
    if (invalid.length) {
      return NextResponse.json({ error: `Not a valid active user id: ${invalid.join(', ')}` }, { status: 400 });
    }
    assignedUserIds = [...new Set(body.assignedUserIds)];
  }

  const db = await readDb();
  const existingIds = new Set((db.projects || []).map(p => p.id));

  // incrementCounter() is atomic against two concurrent requests, but not
  // against the counter's absolute value having drifted from what's
  // actually in the table (e.g. counters got reset/reseeded independently
  // of the data — this has happened in practice). Rather than trust the
  // counter blindly and risk a duplicate-key crash, keep advancing it until
  // it lands on an id that's actually free — self-healing regardless of how
  // it got out of sync, and it never has to loop in the normal case.
  let id;
  for (let attempts = 0; attempts < 1000; attempts++) {
    const seq = await incrementCounter('projectSeq');
    id = `PROJECT-${seq}`;
    if (!existingIds.has(id)) break;
  }

  const now = new Date().toISOString();
  const project = { id, name, description, status, assignedUserIds, createdAt: now, updatedAt: now };

  db.projects = [...(db.projects || []), project];
  await writeDb(db);

  return NextResponse.json({ project }, { status: 201 });
});
