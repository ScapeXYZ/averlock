import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const environmentPath = path.join(packageDirectory, ".env.local");
const publicDaUrl = "https://ctn2-data-availability.flare.network";

if (!fs.existsSync(environmentPath)) throw new Error("gitignored .env.local is missing");
const retained = fs.readFileSync(environmentPath, "utf8").split(/\r?\n/u)
  .filter((line) => !line.startsWith("COSTON2_DA_LAYER_URL=") && !line.startsWith("X_API_KEY="));
retained.push(`COSTON2_DA_LAYER_URL=${publicDaUrl}`, "X_API_KEY=", "");
fs.writeFileSync(environmentPath, retained.join("\n"), { encoding: "utf8", mode: 0o600 });
console.log(`Configured official public Coston2 DA Layer: ${publicDaUrl} (no API key header)`);
