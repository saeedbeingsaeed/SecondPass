import { matchesAny } from "./glob.js";

export interface CandidateFile {
  path: string;
  status: string;
  patch?: string;
}

export interface SkippedFile {
  path: string;
  reason: SkipReason;
}

export type SkipReason =
  | "lockfile"
  | "generated"
  | "binary"
  | "ignored by config"
  | "deleted"
  | "file limit"
  | "token limit";

const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "go.sum",
  "packages.lock.json",
];

const GENERATED = [
  "dist/",
  "build/",
  "out/",
  "vendor/",
  "node_modules/",
  "__snapshots__/",
  "*.snap",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.generated.*",
  "*.g.dart",
  "*.pb.go",
  "*_pb2.py",
  "*.lock",
];

const BINARY_EXTENSIONS = new Set(
  (
    "png jpg jpeg gif webp ico bmp tiff svgz pdf zip gz tgz bz2 xz 7z rar jar war " +
    "woff woff2 ttf otf eot mp3 mp4 mov avi wav ogg webm exe dll so dylib bin class wasm " +
    "pyc o a psd sketch fig"
  ).split(" "),
);

export function skipReason(file: CandidateFile, ignore: string[]): SkipReason | undefined {
  const name = file.path.split("/").pop() ?? file.path;
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (file.status === "removed") return "deleted";
  if (LOCKFILES.includes(name)) return "lockfile";
  // GitHub sends no patch for binaries (and for diffs too large to show).
  if (!file.patch || BINARY_EXTENSIONS.has(extension)) return "binary";
  if (matchesAny(file.path, GENERATED)) return "generated";
  if (matchesAny(file.path, ignore)) return "ignored by config";
  return undefined;
}

// Decides which files to review before we spend API calls fetching contents.
export function selectFiles<T extends CandidateFile>(
  files: T[],
  ignore: string[],
  maxFiles: number,
): { selected: T[]; skipped: SkippedFile[] } {
  const selected: T[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    const reason = skipReason(file, ignore);
    if (reason) skipped.push({ path: file.path, reason });
    else if (selected.length >= maxFiles) skipped.push({ path: file.path, reason: "file limit" });
    else selected.push(file);
  }
  return { selected, skipped };
}

// About 4 characters per token for code. Good enough for budgeting; the
// provider's own count is what we log.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
