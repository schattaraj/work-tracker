import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../lib/auth.js';
import { readDbForUser, writeDbForUser } from '../../../lib/store.js';
import { withApiError } from '../../../lib/withApiError.js';

// Bugs, daily logs, and activity are a fully shared workspace — every active
// user reads and writes the same records, per the shared-workspace model.
// Tasks are split: team tasks are shared the same way, but personal tasks
// (and anything attached to them) are scoped to their creator on both read
// and write — see lib/store.js#readDbForUser / #writeDbForUser.

export const GET = withApiError(async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = await readDbForUser(user.id);
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

  await writeDbForUser(user.id, body);
  return NextResponse.json({ ok: true });
});
