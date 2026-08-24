import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../../lib/auth.js';
import { readDb, writeDb, readUsers, isProjectMember } from '../../../../lib/store.js';
import { withApiError } from '../../../../lib/withApiError.js';

// Shared by GET/PATCH: looks the project up from the server's own data and
// checks membership there — never trusts anything about access from the
// request itself beyond the :id in the URL.
async function loadAuthorizedProject(id, user, db) {
  const project = (db.projects || []).find(p => p.id === id);
  if (!project) return { project: null, allowed: false };
  const allowed = user.role === 'admin' || isProjectMember(project, user.id);
  return { project, allowed };
}

export const GET = withApiError(async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = await readDb();
  const { project, allowed } = await loadAuthorizedProject(id, user, db);
  // 404 (not 403) for both "doesn't exist" and "exists but you're not a
  // member" — deliberately doesn't confirm which, so guessing project ids
  // can't be used to enumerate real ones.
  if (!project || !allowed) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  return NextResponse.json({ project });
});

// Admin-only: edit name/description/status (active|archived — the app's
// existing archive/deactivate concept, reused here), and assign/remove
// members. assignedUserIds is always re-validated against real, currently
// active accounts server-side.
export const PATCH = withApiError(async function PATCH(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 });

  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const db = await readDb();
  const project = (db.projects || []).find(p => p.id === id);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: 'Project name cannot be empty.' }, { status: 400 });
    project.name = name;
  }
  if (body.description !== undefined) project.description = String(body.description);
  if (body.status !== undefined) {
    if (!['active', 'archived'].includes(body.status)) {
      return NextResponse.json({ error: "status must be 'active' or 'archived'." }, { status: 400 });
    }
    project.status = body.status;
  }
  if (body.assignedUserIds !== undefined) {
    if (!Array.isArray(body.assignedUserIds)) {
      return NextResponse.json({ error: 'assignedUserIds must be an array of user ids.' }, { status: 400 });
    }
    const usersData = await readUsers();
    const activeIds = new Set(usersData.users.filter(u => u.status === 'active').map(u => u.id));
    const invalid = body.assignedUserIds.filter(uid => !activeIds.has(uid));
    if (invalid.length) {
      return NextResponse.json({ error: `Not a valid active user id: ${invalid.join(', ')}` }, { status: 400 });
    }
    project.assignedUserIds = [...new Set(body.assignedUserIds)];
  }
  project.updatedAt = new Date().toISOString();

  await writeDb(db);
  return NextResponse.json({ project });
});
