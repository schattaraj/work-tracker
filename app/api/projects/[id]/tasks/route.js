import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../../../lib/auth.js';
import { readDb, isProjectMember } from '../../../../../lib/store.js';
import { withApiError } from '../../../../../lib/withApiError.js';

// Read-only, independently-validated view of one project's tasks — the
// project id in the URL is re-checked against real membership on every
// call, never trusted just because it's in the request. (Task writes still
// go exclusively through PUT /api/data → writeDbForUser, which applies the
// identical per-task authorization — this endpoint exists so a project's
// tasks are also reachable in one call without round-tripping the whole
// shared workspace, and so "for every project-scoped endpoint, validate
// project access server-side" holds for a literal per-project task read
// too, not only for the general blob.)
export const GET = withApiError(async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = await readDb();
  const project = (db.projects || []).find(p => p.id === id);
  if (!project) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (user.role !== 'admin' && !isProjectMember(project, user.id)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const tasks = db.tasks.filter(t => (t.taskType || 'personal') === 'project' && t.projectId === id);
  return NextResponse.json({ tasks });
});
