import { useApiNav } from "./navigation";

interface JumpLinkProps {
  requestId: string;
  anchor: string;
  children: React.ReactNode;
}

/** A link to another place in the API view. */
export function JumpLink({ requestId, anchor, children }: JumpLinkProps) {
  const nav = useApiNav();
  if (!nav) return <span>{children}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        nav.reveal(requestId, anchor);
      }}
      className="text-accent hover:underline shrink-0"
    >
      {children}
    </button>
  );
}
