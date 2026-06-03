/**
 * Tiny mustache-like renderer. Supports `{{var}}` substitution only — no
 * conditionals or loops, intentionally. Cold mail templates should be flat
 * and predictable; complex logic belongs upstream of the template.
 */

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export type TemplateVars = Readonly<Record<string, string | number | null | undefined>>;

export class TemplateError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Missing template variables: ${missing.join(", ")}`);
    this.name = "TemplateError";
    this.missing = missing;
  }
}

export interface RenderOptions {
  /**
   * What to do when a placeholder has no matching variable.
   * - "throw" (default): raise TemplateError, listing missing vars
   * - "blank": substitute an empty string
   * - "keep": leave the `{{...}}` placeholder in place
   */
  onMissing?: "throw" | "blank" | "keep";
}

export function render(
  template: string,
  vars: TemplateVars,
  opts: RenderOptions = {},
): string {
  const onMissing = opts.onMissing ?? "throw";
  const missing: string[] = [];
  const out = template.replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null || value === "") {
      if (onMissing === "throw") {
        if (!missing.includes(key)) missing.push(key);
        return match;
      }
      if (onMissing === "blank") return "";
      return match;
    }
    return String(value);
  });
  if (missing.length > 0) throw new TemplateError(missing);
  return out;
}

/**
 * List the unique placeholder names a template references. Useful for
 * dashboard UIs that want to validate the user provided every variable.
 */
export function listVariables(template: string): string[] {
  const set = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    if (m[1]) set.add(m[1]);
  }
  return [...set];
}
