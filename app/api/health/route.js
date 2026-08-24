import { NextResponse } from 'next/server';
import { usesBlobStorage, activeStorageDriver } from '../../../lib/store.js';
import { ping as mysqlPing } from '../../../lib/storage/mysqlDriver.js';

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

  let mysqlConnected = null;
  if (activeStorageDriver === 'mysql') {
    try {
      await mysqlPing();
      mysqlConnected = true;
    } catch (err) {
      mysqlConnected = false;
      problems.push(`Could not reach MySQL (STORAGE_DRIVER=mysql): ${err.message}`);
    }
  } else if (onVercel && !blobConfigured) {
    problems.push('BLOB_READ_WRITE_TOKEN is not set — connect a Vercel Blob store to this project (Storage → Create Database → Blob), then redeploy. Without it, nothing can be saved on Vercel.');
  }

  return NextResponse.json({
    ok: problems.length === 0,
    environment: onVercel ? 'vercel' : 'local',
    storageDriver: activeStorageDriver,
    storageMode: activeStorageDriver === 'mysql' ? 'mysql' : (blobConfigured ? 'vercel-blob' : 'local-disk'),
    authSecretConfigured,
    blobConfigured,
    mysqlConnected,
    problems
  }, { status: problems.length === 0 ? 200 : 500 });
}
