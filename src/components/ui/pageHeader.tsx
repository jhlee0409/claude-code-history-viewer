import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  tabs?: ReactNode;
  controls?: ReactNode;
}

/** A page owns its h1; callers supply named navigation and scope controls. */
export function PageHeader({ title, description, tabs, controls, className, ...props }: PageHeaderProps) {
  const titleId = useId();
  // Shell title slots can be outside <main>; never introduce a second banner.
  return <header {...props} role="group" aria-labelledby={titleId} data-page-header="" className={cn("flex flex-wrap items-center gap-4 px-[var(--page-inset)] py-4", className)}>
    <div className="min-w-0 flex-1">
      <h1 id={titleId} className="text-title font-semibold text-foreground">{title}</h1>
      {description && <p className="text-list text-muted-foreground">{description}</p>}
    </div>
    {controls && <div className="flex min-w-0 flex-wrap items-center gap-2">{controls}</div>}
    {tabs && <div className="basis-full min-w-0">{tabs}</div>}
  </header>;
}
