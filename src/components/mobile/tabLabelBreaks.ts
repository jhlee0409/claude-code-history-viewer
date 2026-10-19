/**
 * Word runs of a phone tab label, for break opportunities between words.
 *
 * The tab label wraps only between words (`break-keep`), so "プロジェクト"
 * never splits mid-word. Text without spaces ("セッションボード") then has no
 * break at all and holds its tab at full width, crowding its neighbours on a
 * 360 px phone. `Intl.Segmenter` finds the words ("セッション" | "ボード"); the
 * caller puts a `<wbr>` between runs. Spaced text breaks at its spaces and is
 * returned whole. Without `Intl.Segmenter` the label stays one run.
 */
export function wordBreakRuns(text: string, locale: string): string[] {
  if (/\s/.test(text) || typeof Intl.Segmenter !== "function") return [text];
  const runs = Array.from(new Intl.Segmenter(locale, { granularity: "word" }).segment(text), (s) => s.segment);
  return runs.length > 0 ? runs : [text];
}
