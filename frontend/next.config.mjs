/** @type {import('next').NextConfig} */
const deploymentId =
  process.env.DIGITALOCEAN_GIT_COMMIT_SHA ||
  process.env.SOURCE_COMMIT_HASH ||
  process.env.GITHUB_SHA ||
  `${Date.now()}`;

const nextConfig = {
  env: {
    NEXT_PUBLIC_DEPLOYMENT_ID: deploymentId,
  },
};

export default nextConfig;
