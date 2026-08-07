import { NextResponse } from "next/server";
import { isHex, type Hex } from "viem";
import { fetchActionResult, runPolicyHelper, verifiedLiveTee } from "@/lib/averlock/server-fcc";
import { devError } from "@/lib/averlock/errors";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await params;
    const url = new URL(request.url);
    const ruleId = url.searchParams.get("ruleId");
    const commitment = url.searchParams.get("commitment");
    if (!isHex(actionId, { strict: true }) || actionId.length !== 66 || !ruleId || !commitment || !isHex(ruleId, { strict: true }) || !isHex(commitment, { strict: true })) return NextResponse.json({ error: "Invalid result binding." }, { status: 400 });
    const result = await fetchActionResult(actionId as Hex);
    if (result.status === 404) return NextResponse.json({ pending: true }, { status: 202 });
    if (!result.ok) return NextResponse.json({ error: `FCC result endpoint returned ${result.status}.` }, { status: 502 });
    const [response, live] = await Promise.all([result.json(), verifiedLiveTee()]);
    const verified = await runPolicyHelper("verify", { response, expectedTee: live.tee, ruleId, policyCommitment: commitment });
    return NextResponse.json(verified, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    devError("FCC result API", error);
    return NextResponse.json({ error: "FCC result verification is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
