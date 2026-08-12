import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../../lib/auth.js';
import { backupDb } from '../../../../lib/store.js';
import { withApiError } from '../../../../lib/withApiError.js';

export const POST = withApiError(async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 });

  await backupDb();
  return NextResponse.json({ ok: true, backedUpAt: new Date().toISOString() });
});
