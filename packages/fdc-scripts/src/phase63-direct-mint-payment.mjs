import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xrpl from "xrpl";

const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
const CORE_VAULT = "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p";
const RECIPIENT = "0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f";
const PAYMENT_XRP = "702";
const PAYMENT_DROPS = xrpl.xrpToDrops(PAYMENT_XRP);
const MEMO_HEX = `464250526641001800000000${RECIPIENT.slice(2).toLowerCase()}`;

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const environmentPath = path.join(packageDirectory, ".env.local");

function readEnvironment() {
  if (!fs.existsSync(environmentPath)) throw new Error("gitignored .env.local is missing");
  return Object.fromEntries(fs.readFileSync(environmentPath, "utf8").split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}

function persistHash(hash) {
  const lines = fs.readFileSync(environmentPath, "utf8").split(/\r?\n/u)
    .filter((line) => !line.startsWith("XRPL_DIRECT_MINT_HASH="));
  lines.push(`XRPL_DIRECT_MINT_HASH=${hash}`, "");
  fs.writeFileSync(environmentPath, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
}

function publicResult(result, sender) {
  const tx = result.tx_json ?? result;
  const meta = typeof result.meta === "object" ? result.meta : {};
  return {
    network: "XRPL Testnet", sender, coreVault: CORE_VAULT, recipient: RECIPIENT,
    transactionHash: result.hash ?? tx.hash, amountSentXrp: PAYMENT_XRP,
    amountSentDrops: PAYMENT_DROPS, ledgerIndex: result.ledger_index,
    validated: result.validated, transactionResult: meta.TransactionResult,
    memoDataHex: MEMO_HEX, memoBytes: MEMO_HEX.length / 2,
  };
}

async function main() {
  const environment = readEnvironment();
  if (!environment.XRPL_TESTNET_SENDER_SEED) throw new Error("disposable XRPL Testnet sender is not configured");
  const wallet = xrpl.Wallet.fromSeed(environment.XRPL_TESTNET_SENDER_SEED);
  const client = new xrpl.Client(TESTNET_URL);
  await client.connect();
  try {
    if (environment.XRPL_DIRECT_MINT_HASH) {
      const existing = await client.request({ command: "tx", transaction: environment.XRPL_DIRECT_MINT_HASH });
      console.log(JSON.stringify(publicResult(existing.result, wallet.address), null, 2));
      return;
    }
    let balance = Number(await client.getXrpBalance(wallet.address));
    if (balance < 704) {
      await client.fundWallet(wallet, { amount: "1000", usageContext: "AVERLOCK Coston2 FTestXRP direct mint" });
      balance = Number(await client.getXrpBalance(wallet.address));
    }
    if (balance < 704) throw new Error(`sender remains underfunded: ${balance} XRP`);
    if (MEMO_HEX.length !== 64) throw new Error(`direct-mint memo is not 32 bytes: ${MEMO_HEX.length / 2}`);
    const response = await client.submitAndWait({
      TransactionType: "Payment", Account: wallet.address, Destination: CORE_VAULT,
      Amount: PAYMENT_DROPS, Memos: [{ Memo: { MemoData: MEMO_HEX.toUpperCase() } }],
    }, { wallet });
    const result = publicResult(response.result, wallet.address);
    if (!result.validated || result.transactionResult !== "tesSUCCESS" || !result.transactionHash) {
      throw new Error(`direct-mint payment failed: validated=${result.validated} result=${result.transactionResult}`);
    }
    persistHash(result.transactionHash);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(`Direct-mint XRPL Testnet payment failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
