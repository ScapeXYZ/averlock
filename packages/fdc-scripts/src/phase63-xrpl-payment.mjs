import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xrpl from "xrpl";

const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
const PAYMENT_XRP = "1000";
const PAYMENT_DROPS = xrpl.xrpToDrops(PAYMENT_XRP);
const MEMO_TEXT = "AVERLOCK_E2E_V2_001";
const DESTINATION_TAG = 63001;

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const environmentPath = path.join(packageDirectory, ".env.local");

function readEnvironment() {
  if (!fs.existsSync(environmentPath)) throw new Error("gitignored .env.local is missing");
  return Object.fromEntries(
    fs.readFileSync(environmentPath, "utf8").split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function setPaymentHash(hash) {
  const lines = fs.readFileSync(environmentPath, "utf8").split(/\r?\n/u)
    .filter((line) => !line.startsWith("XRPL_PHASE63_PAYMENT_HASH="));
  lines.push(`XRPL_PHASE63_PAYMENT_HASH=${hash}`, "");
  fs.writeFileSync(environmentPath, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
}

function publicResult(result, sender, receiver) {
  const tx = result.tx_json ?? result;
  const meta = typeof result.meta === "object" ? result.meta : {};
  return {
    network: "XRPL Testnet",
    sender,
    receiver,
    transactionHash: result.hash ?? tx.hash,
    amountSentXrp: PAYMENT_XRP,
    amountSentDrops: PAYMENT_DROPS,
    amountReceivedDrops: String(meta.delivered_amount ?? meta.DeliveredAmount ?? PAYMENT_DROPS),
    ledgerIndex: result.ledger_index,
    validated: result.validated,
    transactionResult: meta.TransactionResult,
    memoText: MEMO_TEXT,
    memoDataHex: Buffer.from(MEMO_TEXT, "utf8").toString("hex").toUpperCase(),
    destinationTag: DESTINATION_TAG,
  };
}

async function main() {
  const environment = readEnvironment();
  if (!environment.XRPL_TESTNET_SENDER_SEED || !environment.XRPL_TESTNET_RECEIVER_SEED) {
    throw new Error("disposable XRPL Testnet wallet credentials are not configured");
  }

  const sender = xrpl.Wallet.fromSeed(environment.XRPL_TESTNET_SENDER_SEED);
  const receiver = xrpl.Wallet.fromSeed(environment.XRPL_TESTNET_RECEIVER_SEED);
  const client = new xrpl.Client(TESTNET_URL);
  await client.connect();
  try {
    const senderBalance = await client.getXrpBalance(sender.address);
    const receiverBalance = await client.getXrpBalance(receiver.address);
    if (process.argv.includes("--inspect")) {
      console.log(JSON.stringify({
        network: "XRPL Testnet", sender: sender.address, receiver: receiver.address,
        senderBalanceXrp: senderBalance, receiverBalanceXrp: receiverBalance,
        plannedPaymentXrp: PAYMENT_XRP, memoText: MEMO_TEXT, destinationTag: DESTINATION_TAG,
        existingPhase63PaymentHash: environment.XRPL_PHASE63_PAYMENT_HASH ?? "",
      }, null, 2));
      return;
    }

    if (environment.XRPL_PHASE63_PAYMENT_HASH) {
      const existing = await client.request({ command: "tx", transaction: environment.XRPL_PHASE63_PAYMENT_HASH });
      console.log(JSON.stringify(publicResult(existing.result, sender.address, receiver.address), null, 2));
      return;
    }

    // Keep a conservative reserve/fee margin. Faucet funds are Testnet-only.
    if (Number(senderBalance) < Number(PAYMENT_XRP) + 2) {
      await client.fundWallet(sender, {
        amount: "1000",
        usageContext: "AVERLOCK Phase 6.3E Testnet payment",
      });
    }
    const fundedBalance = await client.getXrpBalance(sender.address);
    if (Number(fundedBalance) < Number(PAYMENT_XRP) + 2) {
      throw new Error(`sender remains underfunded after faucet refill: ${fundedBalance} XRP`);
    }

    const payment = {
      TransactionType: "Payment",
      Account: sender.address,
      Destination: receiver.address,
      DestinationTag: DESTINATION_TAG,
      Amount: PAYMENT_DROPS,
      Memos: [{ Memo: { MemoData: Buffer.from(MEMO_TEXT, "utf8").toString("hex").toUpperCase() } }],
    };
    const response = await client.submitAndWait(payment, { wallet: sender });
    const result = publicResult(response.result, sender.address, receiver.address);
    if (!result.validated || result.transactionResult !== "tesSUCCESS" || !result.transactionHash) {
      throw new Error(`fresh XRPL Testnet payment failed: validated=${result.validated} result=${result.transactionResult}`);
    }
    setPaymentHash(result.transactionHash);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(`Phase 6.3E XRPL Testnet payment failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
