import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const FIXTURES_DIR = path.join(REPO_ROOT, "fixtures");

export function readFixture(filename) {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), "utf8");
}

export function findIssue(issues, code) {
  return issues.find((i) => i.code === code);
}
