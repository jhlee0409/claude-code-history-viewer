import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip";

type Props = {
  children: React.ReactNode;
  content: React.ReactNode;
} & Omit<React.ComponentProps<"button">, "children" | "title">;

export const TooltipButton = ({ children, content, ...props }: Props) => {
  const computedAriaLabel =
    props["aria-label"] ?? (typeof content === "string" ? content : undefined);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type={props.type ?? "button"} {...props} aria-label={computedAriaLabel}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
};
