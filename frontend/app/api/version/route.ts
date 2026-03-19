import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getDeploymentId() {
  return process.env.NEXT_PUBLIC_DEPLOYMENT_ID || "unknown";
}

export async function GET() {
  return NextResponse.json(
    {
      deploymentId: getDeploymentId(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
