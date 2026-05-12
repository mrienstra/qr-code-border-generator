#!/usr/bin/env node
// Filter classifier output to focus on leftmost columns.
// Removes pixel entries with x >= 2 and vertex entries with x >= 3
// (plus their indented continuation lines).
//
// Usage: node test/filter-classifier.mjs <input> [output]
//   If output is omitted, writes to <input> with "-filtered" inserted before .txt

import { readFileSync, writeFileSync } from "fs";
import { basename, dirname, extname, join } from "path";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node test/filter-classifier.mjs <input> [output]");
  process.exit(1);
}

const ext = extname(inputPath);
const outputPath =
  process.argv[3] ??
  join(dirname(inputPath), basename(inputPath, ext) + "-filtered" + ext);

const lines = readFileSync(inputPath, "utf-8").split("\n");
const out = [];
let skipNextIndented = false;

for (const line of lines) {
  if (skipNextIndented) {
    skipNextIndented = false;
    if (line.startsWith("      ")) continue; // deeply-indented continuation
  }

  // pixel(X,Y): filter X >= 2
  const pixelMatch = line.match(/^  pixel\((\d+),/);
  if (pixelMatch && Number(pixelMatch[1]) >= 2) continue;

  // vertex(X,Y): filter X >= 3
  const vertexMatch = line.match(/^  vertex\((\d+),/);
  if (vertexMatch && Number(vertexMatch[1]) >= 3) {
    skipNextIndented = true;
    continue;
  }

  out.push(line);
}

writeFileSync(outputPath, out.join("\n"));
console.log(`Filtered ${lines.length} → ${out.length} lines → ${outputPath}`);
