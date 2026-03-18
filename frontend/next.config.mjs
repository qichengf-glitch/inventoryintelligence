/** @type {import('next').NextConfig} */
const deploymentId =
  process.env.DIGITALOCEAN_GIT_COMMIT_SHA ||
  process.env.SOURCE_COMMIT_HASH ||
  process.env.GITHUB_SHA ||
  `${Date.now()}`;

const nextConfig = {
  env: {
    NEXT_PUBLIC_DEPLOYMENT_ID: deploymentId,
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
  },
};

export default nextConfig;
