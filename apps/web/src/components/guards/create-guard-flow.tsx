"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { bytesToHex, type Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { contracts, coston2, fccConfig } from "@/lib/averlock/config";
import { guardManagerAbi, instructionSenderAbi } from "@/lib/averlock/contracts";
import { compactAddress } from "@/lib/averlock/format";
import { preparePrivatePolicy, waitForPolicyResult } from "@/lib/averlock/fcc-client";
import { saveGuardIndex } from "@/lib/averlock/guard-index";
import { buildPolicy, receiverHash, validateGuardForm, type GuardForm, type ValidationErrors } from "@/lib/averlock/validation";
import { instructionIdFromReceipt, verifyRegisteredGuard, type CreationStage } from "@/lib/averlock/writes";
import { Icon } from "@/components/dashboard/icons";
import { devError, userFacingError } from "@/lib/averlock/errors";

const steps = ["Watch payment", "Private rule", "Release schedule", "Review"];
const defaultExpiry = () => { const date = new Date(Date.now() + 30 * 86_400_000); return date.toISOString().slice(0, 16); };
const initialForm: GuardForm = { xrplDestination: "", thresholdUsd: "", protectPercent: "70", maxPerEventUsd: "", cooldownSeconds: "60", expiresAt: defaultExpiry(), scheduleId: 1 };

export function CreateGuardFlow() {
  const router = useRouter();
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: coston2.id });
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<GuardForm>(initialForm);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [stage, setStage] = useState<CreationStage>("idle");
  const [failure, setFailure] = useState("");
  const busy = !["idle", "failed"].includes(stage);
  const watchedHash = useMemo(() => { try { return receiverHash(form.xrplDestination); } catch { return undefined; } }, [form.xrplDestination]);

  const update = (field: keyof GuardForm, value: string) => { setForm((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: undefined })); };
  const validateStep = () => {
    const all = validateGuardForm(form, address);
    const fields: Array<Array<keyof ValidationErrors>> = [["wallet", "xrplDestination"], ["thresholdUsd", "protectPercent", "maxPerEventUsd", "cooldownSeconds", "expiresAt"], [], []];
    const scoped = Object.fromEntries(Object.entries(all).filter(([key]) => fields[step].includes(key as keyof ValidationErrors))) as ValidationErrors;
    setErrors(scoped); return Object.keys(scoped).length === 0;
  };
  const next = () => { if (validateStep()) setStep((value) => Math.min(3, value + 1)); };

  async function createGuard() {
    if (!address || !publicClient) return setErrors({ wallet: "Connect the wallet that will own this guard." });
    const validation = validateGuardForm(form, address);
    if (Object.keys(validation).length) { setErrors(validation); return; }
    if (chainId !== coston2.id) { setFailure("Switch to Coston2 before creating the guard."); setStage("failed"); return; }
    const ruleId = bytesToHex(crypto.getRandomValues(new Uint8Array(32))) as Hex;
    const policy = buildPolicy(form, ruleId);
    const monitoredReceiverHash = receiverHash(form.xrplDestination);
    try {
      setFailure(""); setStage("preparing");
      const prepared = await preparePrivatePolicy(policy);
      if (prepared.ruleId !== ruleId || prepared.extensionId !== "65927") throw new Error("FCC preparation returned an unexpected rule or extension binding.");
      setStage("policy-signature");
      const policyTx = await writeContractAsync({ chainId: coston2.id, address: contracts.instructionSender, abi: instructionSenderAbi, functionName: "createPolicy", args: [prepared.encryptedEnvelope], value: fccConfig.instructionFee });
      setStage("policy-confirmation");
      const policyReceipt = await publicClient.waitForTransactionReceipt({ hash: policyTx, confirmations: 1 });
      if (policyReceipt.status !== "success") throw new Error("The private-policy instruction transaction reverted.");
      const actionId = instructionIdFromReceipt(policyReceipt);
      setStage("policy-processing");
      const policyResult = await waitForPolicyResult(actionId, ruleId, prepared.policyCommitment);
      if (!policyResult.signatureValid || policyResult.policyCommitment !== prepared.policyCommitment) throw new Error("FCC policy verification failed closed.");
      setStage("guard-signature");
      const registerTx = await writeContractAsync({ chainId: coston2.id, address: contracts.guardManager, abi: guardManagerAbi, functionName: "registerGuard", args: [ruleId, prepared.policyCommitment, monitoredReceiverHash, 1] });
      setStage("guard-confirmation");
      const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerTx, confirmations: 1 });
      if (registerReceipt.status !== "success") throw new Error("Guard registration reverted.");
      setStage("verifying");
      await verifyRegisteredGuard(publicClient, { owner: address, ruleId, commitment: prepared.policyCommitment, receiverHash: monitoredReceiverHash, scheduleId: 1 });
      saveGuardIndex({ ruleId, registrationBlock: registerReceipt.blockNumber.toString(), transactionHash: registerTx, owner: address });
      setForm(initialForm); setStage("complete");
      router.push(`/guards/${ruleId}`);
    } catch (error) {
      devError("guard creation", error); setFailure(userFacingError(error, "Guard creation stopped safely before completion.")); setStage("failed");
    }
  }

  return <div className="create-layout">
    <aside className="create-steps"><p className="eyebrow">Create Guard</p><h1>Private protection, configured by you.</h1><ol>{steps.map((label, index) => <li key={label} className={`${index === step ? "current" : ""} ${index < step ? "done" : ""}`}><span>{index < step ? <Icon name="check"/> : index + 1}</span><div><small>Step {index + 1}</small><strong>{label}</strong></div></li>)}</ol><div className="create-privacy"><Icon name="lock"/><p>Your private policy is encrypted to the live FCC TEE before anything is submitted onchain.</p></div></aside>
    <section className="create-panel">
      <header><div><p className="eyebrow">Step {step + 1} of 4</p><h2>{steps[step]}</h2></div><span className="network-pill"><span/>Coston2</span></header>
      {step === 0 && <div className="form-section"><div className="asset-choice"><span className="xrp-mark">X</span><div><strong>XRP</strong><p>XRPL Testnet · v1 source asset</p></div><Icon name="check"/></div><Field label="XRPL destination to monitor" error={errors.xrplDestination}><input value={form.xrplDestination} onChange={(e) => update("xrplDestination", e.target.value)} placeholder="r…" autoComplete="off"/><small>AVERLOCK stores only its FDC-compatible hash: {watchedHash ? compactAddress(watchedHash, 12, 10) : "enter an address"}</small></Field><div className="identity-separation"><Icon name="wallet"/><div><span>Guard owner on Flare</span><strong>{address ? compactAddress(address, 10, 8) : "Wallet not connected"}</strong></div><div><span>Watched identity</span><strong>XRPL destination</strong></div></div>{errors.wallet && <p className="form-error">{errors.wallet}</p>}<InfoBlock title="How payment verification works">FDC proves a successful XRPL payment to this destination. AVERLOCK does not filter by sender, memo, amount, or destination tag during guard registration because those filters are not supported by the current contract.</InfoBlock></div>}
      {step === 1 && <div className="form-section"><div className="sealed-heading"><span><Icon name="lock"/></span><div><h3>Confidential FCC policy</h3><p>These values are encrypted for confidential evaluation. Only the commitment becomes public.</p></div></div><div className="field-grid"><Field label="Trigger threshold (USD)" error={errors.thresholdUsd}><div className="input-affix"><span>$</span><input type="number" min="0" step="0.01" value={form.thresholdUsd} onChange={(e) => update("thresholdUsd", e.target.value)} placeholder="1000"/></div></Field><Field label="Protection percentage" error={errors.protectPercent}><div className="input-affix suffix"><input type="number" min="0.01" max="100" step="0.01" value={form.protectPercent} onChange={(e) => update("protectPercent", e.target.value)}/><span>%</span></div></Field><Field label="Maximum event value (USD)" error={errors.maxPerEventUsd}><div className="input-affix"><span>$</span><input type="number" min="0" value={form.maxPerEventUsd} onChange={(e) => update("maxPerEventUsd", e.target.value)} placeholder="No cap"/></div></Field><Field label="Cooldown (seconds)" error={errors.cooldownSeconds}><input type="number" min="0" step="1" value={form.cooldownSeconds} onChange={(e) => update("cooldownSeconds", e.target.value)}/></Field><Field label="Policy expiry" error={errors.expiresAt}><input type="datetime-local" value={form.expiresAt} onChange={(e) => update("expiresAt", e.target.value)}/></Field></div><div className="sealed-footer"><Icon name="shield"/><span>Private policy sealed</span><p>Threshold, cap, cooldown, and expiry are excluded from public result data.</p></div></div>}
      {step === 2 && <div className="form-section"><div className="schedule-card selected"><span className="schedule-check"><Icon name="check"/></span><p className="eyebrow">Schedule 1</p><h3>30-day linear release</h3><p>Protection begins when GuardManager creates the position. Value then vests continuously over exactly 30 days.</p><div className="schedule-timeline"><span/><span/><span/><div className="timeline-line"/><div className="timeline-labels"><b>Protection created</b><b>Linear release</b><b>Fully vested</b></div></div></div><InfoBlock title="Non-cancelable by design">ProtectionVault exposes no cancellation or administrative withdrawal path. Only the beneficiary can claim value as it vests.</InfoBlock></div>}
      {step === 3 && <div className="form-section review-section"><div className="review-card"><ReviewRow label="Payment source" value={`XRP → ${form.xrplDestination}`} icon="wallet"/><ReviewRow label="Private rule" value="Sealed" detail={`${form.protectPercent}% protection · commitment created after encryption`} icon="lock"/><ReviewRow label="Private limits" value="Visible only before sealing" detail={`Max ${form.maxPerEventUsd || "uncapped"} USD · ${form.cooldownSeconds}s cooldown · expires ${new Date(form.expiresAt).toLocaleString()}`} icon="shield"/><ReviewRow label="Release" value="30-day linear" icon="vault"/></div><div className="protocol-review"><div><Icon name="proof"/><span>FDC</span><p>Verifies the XRPL payment</p></div><div><Icon name="price"/><span>FTSO</span><p>Snapshots XRP/USD onchain</p></div><div><Icon name="lock"/><span>FCC</span><p>Evaluates the sealed rule</p></div></div><div className="review-notice"><strong>Before you create this guard</strong><ul><li>Private terms are encrypted and never written to public calldata in plaintext.</li><li>Coston2 stores only the commitment and public guard metadata.</li><li>Execution occurs only after a qualifying FDC-verified event and signed FCC decision.</li></ul></div></div>}
      {failure && <div className="creation-failure" role="alert"><Icon name="pulse"/><div><strong>Creation stopped safely</strong><p>{failure}</p></div></div>}
      {busy && <CreationProgress stage={stage}/>}
      <footer><button className="secondary-button" disabled={busy || step === 0} onClick={() => setStep((value) => value - 1)}>Back</button>{step < 3 ? <button className="primary-button" onClick={next}>Continue <Icon name="arrow"/></button> : chainId !== coston2.id ? <button className="primary-button" onClick={() => switchChain({ chainId: coston2.id })}>Switch to Coston2</button> : <button className="primary-button create-cta" disabled={busy} onClick={createGuard}><Icon name="shield"/>Create Protection Guard</button>}</footer>
    </section>
  </div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className={`form-field ${error ? "invalid" : ""}`}><span>{label}</span>{children}{error && <em>{error}</em>}</label>; }
function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) { return <div className="info-block"><Icon name="proof"/><div><strong>{title}</strong><p>{children}</p></div></div>; }
function ReviewRow({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon: string }) { return <div className="review-row"><span><Icon name={icon}/></span><div><small>{label}</small><strong>{value}</strong>{detail && <p>{detail}</p>}</div><Icon name="check"/></div>; }
function CreationProgress({ stage }: { stage: CreationStage }) { const labels: Record<CreationStage, string> = { idle:"", preparing:"Preparing encrypted private policy", "policy-signature":"Awaiting policy instruction signature", "policy-confirmation":"Confirming policy transaction", "policy-processing":"Verifying signed FCC acknowledgment", "guard-signature":"Awaiting guard registration signature", "guard-confirmation":"Confirming guard registration", verifying:"Verifying final onchain bindings", complete:"Guard registered", failed:"" }; return <div className="creation-progress" role="status"><span/><div><strong>{labels[stage]}</strong><p>Do not close this page while the current transaction is pending.</p></div></div>; }
