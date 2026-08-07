import { NextResponse } from "next/server";
import { isHex } from "viem";
import { runPolicyHelper, verifiedLiveTee } from "@/lib/averlock/server-fcc";
import { devError } from "@/lib/averlock/errors";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.policy || !isHex(body.policy.ruleId, { strict: true }) || body.policy.ruleId.length !== 66) return NextResponse.json({ error: "Invalid private policy request." }, { status: 400 });
    const live = await verifiedLiveTee();
    const prepared = await runPolicyHelper("prepare", { policy: body.policy, publicKey: live.publicKey });
    return NextResponse.json({ ...prepared, tee: live.tee, extensionId: "65927" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    devError("policy API", error);
    return NextResponse.json({ error: "Private policy preparation is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
