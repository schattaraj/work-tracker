import { redirect } from 'next/navigation';

// middleware.js has already redirected anyone unauthenticated to
// /login.html before this ever renders, so reaching here means there's a
// valid session — just hand off to the static app shell.
export default function RootPage() {
  redirect('/app.html');
}
