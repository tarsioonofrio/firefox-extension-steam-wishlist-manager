#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IGNORE_DIRS = new Set([".git", "node_modules", ".mcp"]);
const DOC_EXT = new Set([".md"]);

function listMarkdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) out.push(...listMarkdownFiles(full));
      continue;
    }
    if (DOC_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

function normalizeTarget(raw) {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t.startsWith("#")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return null;
  return t.split("#")[0].split("?")[0];
}

function existsResolved(baseFile, target) {
  if (target.includes("*")) return true;
  let resolved;
  if (
    target.startsWith("docs/") ||
    target.startsWith("scripts/") ||
    target.startsWith("src/") ||
    target.startsWith("mcp/")
  ) {
    resolved = path.resolve(ROOT, target);
  } else {
    resolved = path.resolve(path.dirname(baseFile), target);
  }
  return fs.existsSync(resolved);
}

function main() {
  const files = listMarkdownFiles(ROOT);
  const problems = [];

  const mdLink = /\[[^\]]*\]\(([^)]+)\)/g;
  const inlinePath = /`((?:\.{1,2}\/)?(?:docs|scripts|src|mcp)\/[^`\s]+)`/g;

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const re of [mdLink, inlinePath]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const target = normalizeTarget(m[1]);
        if (!target) continue;
        if (!target.startsWith(".") && !target.startsWith("docs/") && !target.startsWith("scripts/") && !target.startsWith("src/") && !target.startsWith("mcp/")) {
          continue;
        }
        if (!existsResolved(file, target)) {
          problems.push({
            file: path.relative(ROOT, file),
            line: lineOf(text, m.index),
            target
          });
        }
      }
    }
  }

  if (problems.length) {
    console.error("error: broken documentation links found:");
    for (const p of problems) {
      console.error(`- ${p.file}:${p.line} -> ${p.target}`);
    }
    process.exit(1);
  }

  console.log("ok: documentation links look valid");
}

main();
