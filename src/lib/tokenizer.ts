// Exact token counting via a LOCAL BPE tokenizer (gpt-tokenizer).
//
// The encoder data is bundled (no network at runtime — the document never
// leaves the machine; this is NOT an API call). It's loaded lazily via dynamic
// import so it ships as a separate chunk and never affects startup/bundle of
// the main app — the ~MB of rank data is fetched only on first use.
//
// `computeTextStats` (lib/textStats.ts) stays the instant heuristic; this gives
// an accurate count for AI-dev workflows once the chunk loads.

export type TokenModel = "o200k" | "cl100k";

// Cache the loaded encoder per model so the data parses only once.
type EncodeFn = (text: string) => number[];
const encoders: Partial<Record<TokenModel, EncodeFn>> = {};
const loading: Partial<Record<TokenModel, Promise<EncodeFn>>> = {};

async function loadEncoder(model: TokenModel): Promise<EncodeFn> {
  if (encoders[model]) return encoders[model]!;
  if (!loading[model]) {
    // o200k_base → GPT-4o / latest; cl100k_base → GPT-3.5/4 (older).
    const imp =
      model === "cl100k"
        ? import("gpt-tokenizer/encoding/cl100k_base")
        : import("gpt-tokenizer/encoding/o200k_base");
    loading[model] = imp.then((m) => {
      const fn = (m as { encode: EncodeFn }).encode;
      encoders[model] = fn;
      return fn;
    });
  }
  return loading[model]!;
}

/** Above this, skip the heavy BPE pass and approximate — guards against a UI
 *  freeze / large allocation when tokenizing a very large document. */
const MAX_EXACT_CHARS = 1_500_000;

/** Exact token count for `text` under the given model (default o200k = GPT-4o/Claude-era).
 *  Falls back to a char/4 approximation for very large input (perf/memory guard). */
export async function countTokensExact(text: string, model: TokenModel = "o200k"): Promise<number> {
  if (text.length > MAX_EXACT_CHARS) return Math.ceil(text.length / 4);
  const encode = await loadEncoder(model);
  return encode(text).length;
}
