/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app is plain static HTML/CSS/JS served from /public; Next.js only
  // powers the /api/* routes (auth + data) and the auth middleware.
  reactStrictMode: true,
};

export default nextConfig;
