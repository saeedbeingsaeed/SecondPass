// Minimal glob matching for ignore patterns, so we don't need a dependency.
//   **  any number of directories     *  anything except "/"     ?  one character except "/"
// A pattern without "/" matches the file name in any directory (like .gitignore),
// and a pattern ending in "/" matches everything under that directory.
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim();
  if (p.endsWith("/")) p += "**";
  if (!p.includes("/")) p = `**/${p}`;
  p = p.replace(/^\//, "");

  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "*" && p[i + 1] === "*") {
      // "**/" matches zero or more directories; a trailing "**" matches everything.
      if (p[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}
