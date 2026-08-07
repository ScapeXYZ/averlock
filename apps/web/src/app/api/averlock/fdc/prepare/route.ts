import { NextResponse } from "next/server";
import { isHex } from "viem";
import { prepareFdc } from "@/lib/averlock/server-fdc";
import { devError } from "@/lib/averlock/errors";
export const runtime = "nodejs";
export async function POST(request: Request) { try { const body = await request.json(); if (!isHex(body.ruleId,{strict:true}) || body.ruleId.length!==66 || !/^[A-Fa-f0-9]{64}$/.test(body.transactionHash||"")) return NextResponse.json({error:"Enter a valid XRPL transaction hash."},{status:400}); return NextResponse.json(await prepareFdc(body.ruleId, body.transactionHash),{headers:{"Cache-Control":"no-store"}}); } catch(error){ devError("FDC prepare API",error); return NextResponse.json({error:error instanceof Error && /destination|validated|delivered|partial|not found/.test(error.message)?error.message:"XRPL/FDC verification is temporarily unavailable."},{status:422,headers:{"Cache-Control":"no-store"}}); } }
