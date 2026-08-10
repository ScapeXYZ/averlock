import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, decodeEventLog, http as viemHttp, parseAbiItem } from "viem";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const number = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
};
const addresses = required("AVERLOCK_CONTRACT_ADDRESSES").split(",").map((value) => value.trim().toLowerCase());
if (addresses.length < 2) throw new Error("AVERLOCK_CONTRACT_ADDRESSES must contain GuardManager then ProtectionVault");
const config = {
  startBlock: BigInt(required("AVERLOCK_START_BLOCK")), confirmations: number("AVERLOCK_CONFIRMATIONS", 12),
  overlap: number("AVERLOCK_REORG_OVERLAP", 24), range: number("AVERLOCK_LOG_BLOCK_RANGE", 250),
  rpcUrl: required("AVERLOCK_RPC_URL"), dbPath: process.env.AVERLOCK_INDEXER_DB_PATH || "./data/averlock-events.sqlite",
};
mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK (id = 1), last_processed_block TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  transaction_hash TEXT NOT NULL, log_index INTEGER NOT NULL, block_number TEXT NOT NULL, block_hash TEXT NOT NULL,
  contract_address TEXT NOT NULL, event_name TEXT NOT NULL, owner TEXT, rule_id TEXT, event_hash TEXT, action_id TEXT,
  position_id TEXT, payload TEXT NOT NULL, PRIMARY KEY (transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS events_owner_block ON events(owner, block_number);
CREATE INDEX IF NOT EXISTS events_rule_block ON events(rule_id, block_number);`);
const cursor = db.prepare("SELECT last_processed_block FROM cursor WHERE id = 1");
const setCursor = db.prepare("INSERT INTO cursor (id,last_processed_block) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET last_processed_block=excluded.last_processed_block");
const deleteFrom = db.prepare("DELETE FROM events WHERE CAST(block_number AS INTEGER) >= CAST(? AS INTEGER)");
const insert = db.prepare(`INSERT INTO events (transaction_hash,log_index,block_number,block_hash,contract_address,event_name,owner,rule_id,event_hash,action_id,position_id,payload)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(transaction_hash,log_index) DO UPDATE SET block_hash=excluded.block_hash, payload=excluded.payload`);
const client = createPublicClient({ transport: viemHttp(config.rpcUrl, { timeout: 20_000, retryCount: 0 }) });

const events = [
  [addresses[0], parseAbiItem("event GuardRegistered(address indexed owner, bytes32 indexed ruleId, bytes32 indexed policyCommitment, bytes32 monitoredReceiverHash, uint32 scheduleId, uint64 createdAt)")],
  [addresses[0], parseAbiItem("event GuardEvaluationPrepared(address indexed owner, bytes32 indexed ruleId, bytes32 indexed eventHash, uint256 eventValueUsd18, uint256 priceUsd18, uint64 priceTimestamp, uint64 paymentTimestamp)")],
  [addresses[0], parseAbiItem("event GuardEvaluated(address indexed owner, bytes32 indexed ruleId, bytes32 indexed eventHash, bytes32 actionId, bool triggered, uint256 eventValueUsd18)")],
  [addresses[0], parseAbiItem("event GuardTriggered(address indexed owner, bytes32 indexed ruleId, bytes32 indexed eventHash, uint256 vaultPositionId, uint256 fxrpAmountProtected, uint32 scheduleId)")],
  [addresses[1], parseAbiItem("event PositionCreated(uint256 indexed positionId, address indexed depositor, address indexed beneficiary, address asset, uint256 amount, uint64 startTimestamp, uint64 endTimestamp, uint64 createdAt)")],
  [addresses[1], parseAbiItem("event Claimed(uint256 indexed positionId, address indexed beneficiary, address indexed asset, uint256 amount, uint256 totalClaimed)")],
];
function normalize(value) { return typeof value === "bigint" ? value.toString() : value; }
function decode(log) {
  for (const [, event] of events) {
    try { const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics }); if (decoded.eventName === event.name) return decoded; } catch { /* try next AVERLOCK event */ }
  }
  return undefined;
}
async function retry(label, fn) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await fn(); } catch (error) { last = error; await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 300 * 2 ** attempt))); }
  }
  throw new Error(`${label} failed after bounded retries: ${last instanceof Error ? last.message : String(last)}`);
}
let lastError; let syncing = false; let lastChainHead; let lastSafeHead;
async function sync() {
  if (syncing) return; syncing = true;
  try {
    const head = await retry("block number", () => client.getBlockNumber());
    const safeHead = head > BigInt(config.confirmations) ? head - BigInt(config.confirmations) : 0n;
    lastChainHead = head; lastSafeHead = safeHead;
    const saved = cursor.get();
    let from = saved ? BigInt(saved.last_processed_block) + 1n - BigInt(config.overlap) : config.startBlock;
    if (from < config.startBlock) from = config.startBlock;
    if (saved) { deleteFrom.run(from.toString()); setCursor.run((from - 1n).toString()); }
    while (from <= safeHead) {
      const to = from + BigInt(config.range - 1) > safeHead ? safeHead : from + BigInt(config.range - 1);
      // viem turns each event ABI into its topic0 filter. This deliberately never
      // asks the RPC for unrelated receipts or generic Coston2 logs.
      const batches = await Promise.all(events.map(([address, event]) => retry(`${event.name} logs ${from}-${to}`, () => client.getLogs({ address, event, fromBlock: from, toBlock: to }))));
      const logs = batches.flat();
      db.exec("BEGIN");
      try {
        for (const log of logs) {
          const decoded = decode(log); if (!decoded || !log.transactionHash || log.logIndex == null || !log.blockHash || !log.blockNumber) continue;
          const args = Object.fromEntries(Object.entries(decoded.args).map(([key, value]) => [key, normalize(value)]));
          const owner = (args.owner || args.beneficiary || "").toString().toLowerCase() || null;
          insert.run(log.transactionHash, Number(log.logIndex), log.blockNumber.toString(), log.blockHash, log.address.toLowerCase(), decoded.eventName, owner, args.ruleId || null, args.eventHash || null, args.actionId || null, args.positionId || args.vaultPositionId || null, JSON.stringify(args));
        }
        setCursor.run(to.toString()); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      from = to + 1n;
    }
    lastError = undefined;
  } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  finally { syncing = false; }
}
function json(response, status, body) { response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
function syncStatus() {
  const saved = cursor.get(); const indexed = saved ? BigInt(saved.last_processed_block) : config.startBlock - 1n;
  const lagBlocks = lastSafeHead === undefined ? undefined : lastSafeHead > indexed ? lastSafeHead - indexed : 0n;
  return { status: lastError ? "degraded" : "ok", syncing, startBlock: config.startBlock.toString(), lastProcessedBlock: indexed.toString(), chainHead: lastChainHead?.toString(), safeHead: lastSafeHead?.toString(), lagBlocks: lagBlocks?.toString(), confirmations: config.confirmations, reorgOverlap: config.overlap, lastError };
}
const rowsForOwner = db.prepare("SELECT * FROM events WHERE owner = ? ORDER BY CAST(block_number AS INTEGER) DESC, log_index DESC LIMIT 500");
const guardsForOwner = db.prepare("SELECT * FROM events WHERE owner = ? AND event_name = 'GuardRegistered' ORDER BY CAST(block_number AS INTEGER) DESC LIMIT 100");
const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
  if (url.pathname === "/health") return json(response, lastError ? 503 : 200, { ...syncStatus(), service: "averlock-event-indexer" });
  if (url.pathname === "/sync") return json(response, 200, syncStatus());
  const owner = url.searchParams.get("owner")?.toLowerCase();
  if ((url.pathname === "/activity" || url.pathname === "/guards") && !/^0x[0-9a-f]{40}$/.test(owner || "")) return json(response, 400, { error: "A valid owner address is required" });
  if (url.pathname === "/activity") return json(response, 200, { items: rowsForOwner.all(owner).map((row) => ({ ...row, payload: JSON.parse(row.payload) })), sync: syncStatus() });
  if (url.pathname === "/guards") return json(response, 200, { items: guardsForOwner.all(owner).map((row) => ({ ...row, payload: JSON.parse(row.payload) })), sync: syncStatus() });
  return json(response, 404, { error: "Not found" });
});
server.listen(Number(process.env.PORT || 8080), "0.0.0.0", () => { console.log("AVERLOCK event indexer listening"); sync(); setInterval(sync, 15_000).unref(); });
