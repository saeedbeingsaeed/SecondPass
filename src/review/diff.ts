// Parses the unified diff GitHub returns for one file (the `patch` field) and
// works out which lines of the NEW file appear in it. Only those lines can
// carry an inline review comment.

export interface ParsedPatch {
  // New-file line numbers added by this PR.
  added: Set<number>;
  // New-file line numbers shown as unchanged context inside a hunk.
  context: Set<number>;
  // Text of every new-file line that appears in the diff.
  lines: Map<number, string>;
  // Removed lines, keyed by the new-file line number they sat just above.
  deletedBefore: Map<number, string[]>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(patch: string): ParsedPatch {
  const parsed: ParsedPatch = {
    added: new Set(),
    context: new Set(),
    lines: new Map(),
    deletedBefore: new Map(),
  };
  let newLine = 0;
  // Lines left in the current hunk, from the header counts. Using the counts
  // (instead of "any line after @@") stops a trailing empty line from being
  // miscounted as context.
  let oldLeft = 0;
  let newLeft = 0;

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLine = Number(header[3]);
      newLeft = header[4] === undefined ? 1 : Number(header[4]);
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0) continue;
    // "\ No newline at end of file" describes the previous line; it is not content.
    if (raw.startsWith("\\")) continue;

    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      parsed.added.add(newLine);
      parsed.lines.set(newLine, text);
      newLine++;
      newLeft--;
    } else if (marker === "-") {
      const removed = parsed.deletedBefore.get(newLine) ?? [];
      removed.push(text);
      parsed.deletedBefore.set(newLine, removed);
      oldLeft--;
    } else {
      // Context line. Some tools strip the leading space from blank lines.
      parsed.context.add(newLine);
      parsed.lines.set(newLine, marker === " " ? text : raw);
      newLine++;
      oldLeft--;
      newLeft--;
    }
  }
  return parsed;
}

// True when GitHub will accept an inline comment on this line (side RIGHT).
export function isCommentable(parsed: ParsedPatch, line: number): boolean {
  return parsed.added.has(line) || parsed.context.has(line);
}
