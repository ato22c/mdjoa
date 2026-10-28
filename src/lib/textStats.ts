// Lightweight utility that computes the token/word/character counts of the current document.
// Works with no external dependencies (no real BPE tokenizer is used).

export interface TextStats {
  /** Token count (approximate) */
  tokens: number;
  /** Word count */
  words: number;
  /** Character count */
  chars: number;
}

// ─── Token estimation tuning constants ──────────────────────────────────
// The values below "approximate" the empirical behavior of tiktoken
// (o200k_base / cl100k_base) family tokenizers on mixed-language input.
// They are not for exact billing/limit calculation — strictly an estimate.

/**
 * Tokens per CJK character (Hangul/Hanja/Kana/CJK ideographs).
 * Recent tokenizers (o200k_base = GPT-4o, Claude family) handle Hangul/CJK
 * efficiently, at roughly ~1 token per syllable. (The older cl100k was costlier at
 * ~1.5–2.5, but this app's main users run recent models, so 1.0 is the default.)
 */
const CJK_TOKENS_PER_CHAR = 1.0;

/**
 * Characters-per-token ratio for "ordinary text": Latin letters, digits, punctuation, whitespace, etc.
 * Heuristic of roughly 4 characters ≈ 1 token (the usual ratio for English BPE).
 */
const LATIN_CHARS_PER_TOKEN = 4;

/**
 * Tokens per emoji/symbol cluster.
 * ZWJ sequences (👨‍👩‍👧‍👦), regional-indicator flags (🇰🇷), variation selectors, etc.
 * get split into several tokens by BPE, so a cluster is approximated as 2 tokens.
 */
const EMOJI_TOKENS_PER_CLUSTER = 2;

/**
 * Decide whether a code point belongs to the CJK family (Hangul, Hanja, Kana, etc.).
 * Ranges used:
 *  - Hangul syllables  AC00–D7A3
 *  - Hangul Jamo       1100–11FF, 3130–318F (compatibility Jamo)
 *  - Kana              3040–30FF (Hiragana/Katakana)
 *  - CJK unified       3400–4DBF (ext. A), 4E00–9FFF (basic)
 *  - CJK compatibility F900–FAFF
 *  - CJK ext. B+       20000–2FA1F (supplementary plane)
 */
function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
    (cp >= 0x3130 && cp <= 0x318f) || // Hangul compatibility Jamo
    (cp >= 0x3040 && cp <= 0x30ff) || // Hiragana + Katakana
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext. A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0x20000 && cp <= 0x2fa1f) // CJK ext. B–F + compat supplement
  );
}

/**
 * Decide whether a code point belongs to the emoji/pictograph/symbol family.
 * Ranges:
 *  - 1F300–1FAFF  Misc symbols & pictographs, emoji, supplemental
 *  - 2600–27BF    Misc symbols + dingbats
 *  - 2B00–2BFF    Misc symbols & arrows
 *  - 1F000–1F2FF  Mahjong/Domino/Playing cards/Enclosed
 *  - 1F1E6–1F1FF  Regional indicators (flags)
 *  - FE00–FE0F    Variation selectors
 *  - 200D         Zero-width joiner (ZWJ)
 */
function isEmojiCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    (cp >= 0x1f000 && cp <= 0x1f2ff) ||
    (cp >= 0x1f1e6 && cp <= 0x1f1ff) || // regional indicators
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    cp === 0x200d // ZWJ
  );
}

/**
 * Compute stats from a raw Markdown string.
 *
 * - chars: total character count. Split with [...str] so Unicode/emoji are
 *   counted accurately by code point.
 * - words: number of non-empty whitespace-separated tokens.
 *   (CJK is undercounted by whitespace splitting, but that is intended.)
 * - tokens: a language-aware approximation. Instead of a real BPE tokenizer,
 *   it classifies characters into CJK / Latin (ordinary text) / emoji buckets
 *   and sums each bucket's weight:
 *     tokens ≈ round(cjkChars * 1.5 + ordinaryChars / 4 + emojiClusters * 2)
 *   This is an estimate kept light with no dependencies; do not use it for
 *   exact billing/limit calculation.
 */
export function computeTextStats(source: string): TextStats {
  const chars = [...source].length;
  const words = source.split(/\s+/).filter((w) => w.length > 0).length;

  let cjkChars = 0;
  let latinishChars = 0; // Latin/digits/punctuation/whitespace etc. (ordinary text)
  let emojiClusters = 0;
  let emojiCodePointsCounted = 0; // guards against double classification in the cluster fallback

  // To count an emoji cluster (ZWJ sequence, flag, etc.) as one, use
  // Intl.Segmenter (grapheme) when available. Where it is unsupported, fall
  // back via catch and estimate by code point only.
  let usedSegmenter = false;
  try {
    const Seg = (
      Intl as unknown as {
        Segmenter?: new (
          locale?: string,
          options?: { granularity?: string },
        ) => { segment(input: string): Iterable<{ segment: string }> };
      }
    ).Segmenter;
    if (typeof Seg === "function") {
      const segmenter = new Seg(undefined, { granularity: "grapheme" });
      for (const { segment } of segmenter.segment(source)) {
        const cp = segment.codePointAt(0) ?? 0;
        if (isEmojiCodePoint(cp)) {
          // Count one grapheme as one emoji cluster.
          emojiClusters += 1;
          emojiCodePointsCounted += [...segment].length;
        }
      }
      usedSegmenter = true;
    }
  } catch {
    usedSegmenter = false;
  }

  // Fill the CJK / Latin buckets by code point.
  // (Emoji already counted via Segmenter are excluded here; otherwise estimate clusters as a fallback.)
  for (const ch of source) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isEmojiCodePoint(cp)) {
      if (!usedSegmenter) {
        // Fallback: combining characters such as ZWJ/variation selectors are not
        // counted as a new cluster; only other emoji code points approximate clusters.
        if (cp !== 0x200d && !(cp >= 0xfe00 && cp <= 0xfe0f)) {
          emojiClusters += 1;
        }
      }
      // Emoji code points do not go into the Latin/CJK buckets.
      continue;
    }
    if (isCjkCodePoint(cp)) {
      cjkChars += 1;
    } else {
      latinishChars += 1;
    }
  }

  // So emoji code points aren't wrongly accumulated into latin/cjk on the Segmenter path
  // (the loop above already excludes them via continue, so no extra correction is needed)
  void emojiCodePointsCounted;

  const tokens = Math.max(
    0,
    Math.round(
      cjkChars * CJK_TOKENS_PER_CHAR +
        latinishChars / LATIN_CHARS_PER_TOKEN +
        emojiClusters * EMOJI_TOKENS_PER_CLUSTER,
    ),
  );

  return { tokens, words, chars };
}
