import fs from "node:fs/promises";
import path from "node:path";

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const root = process.cwd();
  const src = path.join(root, ".env");
  const dst = path.join(root, "apps", "api-gateway", ".env");

  // Local dev ergonomics: allow a single `.env` at repo root and sync it into
  // `apps/api-gateway/.env` (Next.js reads env from its project root).
  if (!(await exists(src))) return;

  const dstExists = await exists(dst);
  if (!dstExists) {
    await fs.copyFile(src, dst);
    return;
  }

  const [srcStat, dstStat] = await Promise.all([fs.stat(src), fs.stat(dst)]);
  if (srcStat.mtimeMs > dstStat.mtimeMs) {
    await fs.copyFile(src, dst);
  }
}

main().catch((err) => {
  console.error("[sync-env] failed", err?.message ?? String(err));
  process.exit(1);
});

