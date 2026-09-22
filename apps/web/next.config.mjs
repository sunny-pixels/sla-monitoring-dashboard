/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The upload target is the deployed Cloudflare Worker directly — no
  // rewrite/proxy through a Next.js API route (see README "Architecture").
};

export default nextConfig;
