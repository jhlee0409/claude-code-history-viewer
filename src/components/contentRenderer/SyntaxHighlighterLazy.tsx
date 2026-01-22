/**
 * LazySyntaxHighlighter - Lazy-loaded syntax highlighting component
 *
 * Provides code highlighting with lazy loading for better initial bundle size.
 * Shows a skeleton loader while the syntax highlighter loads.
 */

import { lazy, Suspense } from "react";
import type { SyntaxHighlighterProps } from "react-syntax-highlighter";

// Lazy load the syntax highlighter
const SyntaxHighlighter = lazy(() =>
  import("react-syntax-highlighter").then((module) => ({
    default: module.Prism,
  }))
);

interface LazySyntaxHighlighterProps extends SyntaxHighlighterProps {
  fallback?: React.ReactNode;
}

export function LazySyntaxHighlighter({
  fallback,
  style,
  ...props
}: LazySyntaxHighlighterProps) {
  return (
    <Suspense
      fallback={
        fallback || (
          <div className="animate-pulse bg-secondary rounded p-4">
            <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-muted rounded w-1/2 mb-2"></div>
            <div className="h-4 bg-muted rounded w-5/6"></div>
          </div>
        )
      }
    >
      <Suspense fallback={null}>
        <SyntaxHighlighter style={style} {...props} />
      </Suspense>
    </Suspense>
  );
}

// Example usage:
// import { LazySyntaxHighlighter } from './SyntaxHighlighterLazy';
//
// <LazySyntaxHighlighter
//   language="typescript"
//   style={vscDarkPlus}
//   showLineNumbers
// >
//   {code}
// </LazySyntaxHighlighter>
