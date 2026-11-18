/**
 * Typo- and abbreviation-tolerant matching for short titles (project names,
 * session names).
 *
 * It only widens a plain substring match, so callers try the substring first
 * and ask this module only when that failed. A title matches when either:
 *
 * - the query abbreviates consecutive words of the title, each piece being a
 *   prefix of its word: `cchv` and `clcohi` both match
 *   `claude-code-history-viewer`, `hisview` matches `history viewer`.
 *   A separator in the query starts a new word (`hist view`).
 * - every word of the query is found in the title, in any order, either as
 *   a substring or, for words of 4+ characters, with one typo (a wrong,
 *   missing, extra or swapped character) against the start of a title word:
 *   `histroy` matches `history`, `bug login` matches `Fix login bug`.
 *
 * Queries shorter than 3 characters only ever match as substrings: shorter
 * abbreviations would match most titles.
 */

/** Below this many letters/digits the query gets no fuzzy matching. */
const MIN_FUZZY_LENGTH = 3;
/** Query words this long and longer tolerate one typo. */
const MIN_TYPO_LENGTH = 4;
/** Longer queries are not abbreviations; skip the abbreviation search. */
const MAX_ABBREVIATION_LENGTH = 64;

const WORD_SEPARATORS = /[^\p{L}\p{N}]+/u;
const CAMEL_BOUNDARY = /(\p{Ll})(\p{Lu})/gu;

export interface FuzzyTitleQuery {
  /** The query's letters and digits, separators removed. */
  compact: string;
  /** `wordStart[i]`: `compact[i]` begins a query word (after a separator). */
  wordStart: boolean[];
  /** The query's words, for the any-order / one-typo rule. */
  words: string[];
}

/**
 * Prepares `query` (already trimmed and lowercased) for `fuzzyTitleMatches`.
 * Null when the query is too short for fuzzy matching.
 */
export const compileFuzzyTitleQuery = (query: string): FuzzyTitleQuery | null => {
  const words = query.split(WORD_SEPARATORS).filter(Boolean);
  const compact = words.join("");
  if (compact.length < MIN_FUZZY_LENGTH) return null;
  const wordStart: boolean[] = [];
  for (const word of words) {
    for (let i = 0; i < word.length; i += 1) wordStart.push(i === 0);
  }
  return { compact, wordStart, words };
};

/**
 * Lowercased words of `text`. Splits on anything that is not a letter or a
 * digit and on camelCase boundaries (`HistoryViewer` → history, viewer).
 */
export const splitTitleWords = (text: string): string[] =>
  text
    .replace(CAMEL_BOUNDARY, "$1 $2")
    .toLowerCase()
    .split(WORD_SEPARATORS)
    .filter(Boolean);

/** `needle` is a subsequence of `haystack`: a cheap test that rules most titles out. */
const isSubsequence = (needle: string, haystack: string): boolean => {
  let from = 0;
  for (let i = 0; i < needle.length; i += 1) {
    const at = haystack.indexOf(needle[i] as string, from);
    if (at < 0) return false;
    from = at + 1;
  }
  return true;
};

// Failed (query offset, word index) states of the abbreviation search,
// reused across calls; the cells a search needs are cleared before it.
let visited = new Uint8Array(256);

const matchesAbbreviation = (query: FuzzyTitleQuery, titleWords: readonly string[]): boolean => {
  const { compact, wordStart } = query;
  const n = compact.length;
  const m = titleWords.length;
  const size = (n + 1) * (m + 1);
  if (visited.length < size) visited = new Uint8Array(size);
  else visited.fill(0, 0, size);

  // Can compact[qi..] be spelled by prefixes of titleWords[wi], [wi+1], ...?
  const spell = (qi: number, wi: number): boolean => {
    if (qi === n) return true;
    if (wi === m) return false;
    const cell = qi * (m + 1) + wi;
    if (visited[cell]) return false;
    const word = titleWords[wi] as string;
    // The longest piece this word can take: its common prefix with the rest
    // of the query, stopping where the query starts a new word.
    let longest = 0;
    while (
      longest < word.length &&
      qi + longest < n &&
      (longest === 0 || !wordStart[qi + longest]) &&
      word.charCodeAt(longest) === compact.charCodeAt(qi + longest)
    ) {
      longest += 1;
    }
    for (let take = longest; take > 0; take -= 1) {
      if (spell(qi + take, wi + 1)) return true;
    }
    visited[cell] = 1;
    return false;
  };

  for (let start = 0; start < m; start += 1) {
    if (spell(0, start)) return true;
  }
  return false;
};

/**
 * Whether `a` and `b.slice(0, bLength)` are at most one edit apart (one
 * substitution, insertion, deletion, or swap of neighbours).
 */
const withinOneEdit = (a: string, b: string, bLength: number): boolean => {
  const aLength = a.length;
  let i = 0;
  while (i < aLength && i < bLength && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  if (i === aLength && i === bLength) return true;

  const restEqual = (ai: number, bi: number): boolean => {
    if (aLength - ai !== bLength - bi) return false;
    for (; ai < aLength; ai += 1, bi += 1) {
      if (a.charCodeAt(ai) !== b.charCodeAt(bi)) return false;
    }
    return true;
  };

  if (aLength === bLength) {
    return (
      restEqual(i + 1, i + 1) ||
      (i + 1 < aLength &&
        a.charCodeAt(i) === b.charCodeAt(i + 1) &&
        a.charCodeAt(i + 1) === b.charCodeAt(i) &&
        restEqual(i + 2, i + 2))
    );
  }
  return aLength > bLength ? restEqual(i + 1, i) : restEqual(i, i + 1);
};

/**
 * One typo away from the start of `word`: the compared start is the query
 * word's length, one shorter or one longer, never under 4 characters.
 */
const typoMatchesWord = (queryWord: string, word: string): boolean => {
  const length = queryWord.length;
  for (let prefix = length - 1; prefix <= length + 1; prefix += 1) {
    if (prefix < MIN_TYPO_LENGTH || prefix > word.length) continue;
    if (withinOneEdit(queryWord, word, prefix)) return true;
  }
  return false;
};

/**
 * Whether `title` fuzzily matches `query`. Meant for titles that did not
 * contain the query as a substring; it does not test that case itself.
 */
export const fuzzyTitleMatches = (query: FuzzyTitleQuery, title: string): boolean => {
  if (!title) return false;
  const lowerTitle = title.toLowerCase();
  const titleWords = splitTitleWords(title);
  if (
    query.compact.length <= MAX_ABBREVIATION_LENGTH &&
    isSubsequence(query.compact, lowerTitle) &&
    matchesAbbreviation(query, titleWords)
  ) {
    return true;
  }
  return query.words.every(
    (queryWord) =>
      lowerTitle.includes(queryWord) ||
      (queryWord.length >= MIN_TYPO_LENGTH &&
        titleWords.some((word) => typoMatchesWord(queryWord, word)))
  );
};
