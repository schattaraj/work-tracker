import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../lib/auth.js';
import { readDb, writeDb } from '../../../lib/store.js';
import { withApiError } from '../../../lib/withApiError.js';

// The whole team/workspace shares one db.json (tasks, bugs, daily logs,
// voice notes, screenshots, activity). Any active user can read and write
// it — login only gates *who* gets in, per the shared-workspace model.

export const GET = withApiError(async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = await readDb();
  return NextResponse.json(db);
});

export const PUT = withApiError(async function PUT(request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected a JSON object.' }, { status: 400 });
  }

  await writeDb(body);
  return NextResponse.json({ ok: true });
});
