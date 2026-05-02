#!/usr/bin/env node
/**
 * Next.js standalone output is self-contained but DOES NOT include the
 * static assets (.next/static) or public/ — you must copy them next to
 * server.js yourself. This runs as `pnpm postbuild` after `next build`.
 *
 * Layout after this script:
 *   .next/standalone/
 *     apps/web/
 *       server.js           (Next-generated)
 *       package.json        (Next-generated)
 *       .next/
 *         static/           ← copied here
 *       public/             ← copied here (if it exists)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SRC_STATIC = path.join(root, ".next", "static");
const DST_STATIC = path.join(root, ".next", "standalone", "apps", "web", ".next", "static");

const SRC_PUBLIC = path.join(root, "public");
const DST_PUBLIC = path.join(root, ".next", "standalone", "apps", "web", "public");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copy(src, dst) {
  await fs.rm(dst, { recursive: true, force: true });
  await fs.cp(src, dst, { recursive: true });
}

if (await exists(SRC_STATIC)) {
  await copy(SRC_STATIC, DST_STATIC);
  console.log(`postbuild: copied .next/static -> ${path.relative(root, DST_STATIC)}`);
} else {
  console.warn(`postbuild: ${SRC_STATIC} missing; did 'next build' succeed?`);
  process.exit(1);
}

if (await exists(SRC_PUBLIC)) {
  await copy(SRC_PUBLIC, DST_PUBLIC);
  console.log(`postbuild: copied public -> ${path.relative(root, DST_PUBLIC)}`);
}
