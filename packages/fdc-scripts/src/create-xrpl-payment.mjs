import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xrpl from "xrpl";

const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
const PAYMENT_DROPS = "10000000";
const MEMO_TEXT = "AVERLOCK_DEMO_001";
const DESTINATION_TAG = 42001;

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const environmentPath = path.join(packageDirectory, ".env.local");

function readLocalEnvironment() {
  if (!fs.existsSync(environmentPath)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(environmentPath, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function writeLocalEnvironment(sender, receiver, transactionHash = "") {
  const contents = [
    "# Disposable XRPL Testnet credentials. Gitignored; never use on mainnet.",
    `XRPL_TESTNET_SENDER_SEED=${sender.seed}`,
    `XRPL_TESTNET_RECEIVER_SEED=${receiver.seed}`,
    `XRPL_TESTNET_PAYMENT_HASH=${transactionHash}`,
    "",
  ].join("\n");

  fs.writeFileSync(environmentPath, contents, { encoding: "utf8", mode: 0o600 });
}

function publicPaymentResult(result, senderAddress, receiverAddress) {
  const transaction = result.tx_json ?? result;
  const metadata = typeof result.meta === "object" ? result.meta : {};
  const transactionHash = result.hash ?? transaction.hash;
  const receivedAmount = metadata.delivered_amount ?? metadata.DeliveredAmount ?? PAYMENT_DROPS;

  return {
    network: "XRPL Testnet",
    senderAddress,
    receiverAddress,
    transactionHash,
    amountSentDrops: PAYMENT_DROPS,
    amountSentXrp: xrpl.dropsToXrp(PAYMENT_DROPS),
    amountReceivedDrops: String(receivedAmount),
    ledgerIndex: result.ledger_index,
    validated: result.validated,
    transactionResult: metadata.TransactionResult,
    memoText: MEMO_TEXT,
    memoDataHex: Buffer.from(MEMO_TEXT, "utf8").toString("hex").toUpperCase(),
    destinationTag: DESTINATION_TAG,
  };
}

async function main() {
  const client = new xrpl.Client(TESTNET_URL);
  await client.connect();

  try {
    const localEnvironment = readLocalEnvironment();
    let sender;
    let receiver;

    if (localEnvironment.XRPL_TESTNET_SENDER_SEED && localEnvironment.XRPL_TESTNET_RECEIVER_SEED) {
      sender = xrpl.Wallet.fromSeed(localEnvironment.XRPL_TESTNET_SENDER_SEED);
      receiver = xrpl.Wallet.fromSeed(localEnvironment.XRPL_TESTNET_RECEIVER_SEED);
    } else {
      ({ wallet: sender } = await client.fundWallet(null, { usageContext: "AVERLOCK Phase 4 Testnet sender" }));
      ({ wallet: receiver } = await client.fundWallet(null, {
        usageContext: "AVERLOCK Phase 4 monitored Testnet receiver",
      }));
      writeLocalEnvironment(sender, receiver);
    }

    if (localEnvironment.XRPL_TESTNET_PAYMENT_HASH) {
      const existing = await client.request({
        command: "tx",
        transaction: localEnvironment.XRPL_TESTNET_PAYMENT_HASH,
      });
      console.log(JSON.stringify(publicPaymentResult(existing.result, sender.address, receiver.address), null, 2));
      return;
    }

    const payment = {
      TransactionType: "Payment",
      Account: sender.address,
      Destination: receiver.address,
      DestinationTag: DESTINATION_TAG,
      Amount: PAYMENT_DROPS,
      Memos: [
        {
          Memo: {
            MemoData: Buffer.from(MEMO_TEXT, "utf8").toString("hex").toUpperCase(),
          },
        },
      ],
    };

    const response = await client.submitAndWait(payment, { wallet: sender });
    const result = publicPaymentResult(response.result, sender.address, receiver.address);
    if (!result.validated || result.transactionResult !== "tesSUCCESS" || !result.transactionHash) {
      throw new Error("XRPL Testnet payment did not validate successfully");
    }

    writeLocalEnvironment(sender, receiver, result.transactionHash);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(`XRPL Testnet demo failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
