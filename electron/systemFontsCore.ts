const FONT_SUFFIX_REGEX =
  /\s*\((?:TrueType|OpenType|All res|VGA res|8514 res|EGA res|CGA res|Plotter|Type 1|WOFF|WOFF2)\)\s*$/i;

const TRAILING_STYLE_TOKEN_REGEX =
  /\s+(?:Regular|Bold|Italic|Oblique|Light|Semilight|SemiLight|ExtraLight|UltraLight|Medium|Semibold|SemiBold|DemiBold|ExtraBold|UltraBold|Thin)$/i;

/**
 * Parses Windows `reg query` font registry output into a sorted, case-insensitively
 * deduplicated list of clean font family names suitable for CSS `font-family`.
 */
export function parseWindowsFontRegistryOutput(rawOutputs: string[]): string[] {
  const seen = new Map<string, string>();

  for (const output of rawOutputs) {
    if (!output) continue;
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s+(.+?)\s+REG_SZ\s+(.+)$/);
      if (!match) continue;

      let rawName = match[1].trim();
      if (!rawName || rawName === '(Default)') continue;

      rawName = rawName.replace(FONT_SUFFIX_REGEX, '').trim();
      if (!rawName) continue;

      const parts = rawName.split(/\s*&\s*/);
      for (const part of parts) {
        let family = part.trim();
        if (!family || family.startsWith('@')) continue;

        let stripped = family;
        while (true) {
          const next = stripped.replace(TRAILING_STYLE_TOKEN_REGEX, '').trim();
          if (next === stripped || !next) break;
          stripped = next;
        }
        family = stripped.trim();

        if (!family || family.startsWith('@')) continue;
        // Skip internal Windows bitmap/hidden/symbol font names
        if (/^(?:marlett|webdings|wingdings(?:\s*\d*)?|symbol|holomdl2 assets|segoe mdl2 assets|segoe fluent icons)$/i.test(family)) {
          continue;
        }

        const key = family.toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, family);
        }
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}
