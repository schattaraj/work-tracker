// Minimal root layout. The actual UI lives in plain static HTML under
// /public (app.html, login.html, register.html, admin.html) — this route
// tree exists only to power /api/* and the "/" entry redirect below.
export const metadata = {
  title: 'DevTrack',
  description: 'Personal Developer Work Tracker'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
