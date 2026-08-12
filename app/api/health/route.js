import { NextResponse } from 'next/server';
import { usesBlobStorage } from '../../../lib/store.js';

// Public, unauthenticated by design — its whole point is to be reachable
// even when login is broken, so you can tell *why* before you can sign in
// to see anything else. Reports presence, not values, of required config.
export async function GET() {
  const onVercel = !!process.env.VERCEL;
  const authSecretConfigured = !!process.env.AUTH_SECRET;
  const blobConfigured = usesBlobStorage;

  const problems = [];
  if (!authSecretConfigured) {
    problems.push('AUTH_SECRET is not set — add it in Vercel Project Settings → Environment Variables, then redeploy. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  if (onVercel && !blobConfigured) {
    problems.push('BLOB_READ_WRITE_TOKEN is not set — connect a Vercel Blob store to this project (Storage → Create Database → Blob), then redeploy. Without it, nothing can be saved on Vercel.');
  }

  return NextResponse.json({
    ok: problems.length === 0,
    environment: onVercel ? 'vercel' : 'local',
    storageMode: blobConfigured ? 'vercel-blob' : 'local-disk',
    authSecretConfigured,
    blobConfigured,
    problems
  }, { status: problems.length === 0 ? 200 : 500 });
}
