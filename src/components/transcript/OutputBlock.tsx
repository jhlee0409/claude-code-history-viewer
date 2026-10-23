/**
 * OutputBlock (plan §4.3, TR0) — RED-phase stub with the final props.
 */

export interface OutputBlockProps {
  text?: string;
  errorText?: string;
  recordedExitCode?: number;
  searchQuery?: string;
  lineCap?: number;
  expandKey?: string;
}

export function OutputBlock({ text }: OutputBlockProps) {
  return <div>{text}</div>;
}
