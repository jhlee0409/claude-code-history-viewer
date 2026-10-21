import * as React from "react";

import { cn } from "@/lib/utils";
import { Label } from "./label";

/**
 * Field: a control with its label, help and error text (inner-UI plan F2a,
 * G-ST8, G-SR4). Input, Textarea and SelectTrigger read it:
 *
 *   <Field label={t("…")} help={t("…")} error={error}>
 *     <Input />
 *   </Field>
 *
 * - The label names the control: `<label for>` its id (a control's own `id`
 *   wins and the label follows it); a Select trigger (a button) also points
 *   at the label with aria-labelledby.
 * - Help and error text describe it (`aria-describedby`, the control's own
 *   description first, then help, then error).
 * - An error marks it `aria-invalid` (its border turns to the danger line).
 *   The error text is static, not a live region: announcing it is the
 *   screen's decision (Notice `live`).
 */

interface FieldContextValue {
  controlId: string;
  labelId: string;
  describedBy: string | undefined;
  invalid: boolean;
  /** A control with its own `id` registers it, so the label points at it. */
  registerId: (id: string | null) => void;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

/**
 * The border and states every field control shares: a --line-input border
 * (≥ 3:1 on its surface), the danger line when invalid, full --fg on hover
 * (valid or invalid: the danger line and --status-danger-fg are too close
 * in the high-contrast themes to show a hover step; the error text stays),
 * and the disabled tokens instead of fading. Focus is the base ring.
 */
export const fieldControlClasses =
  "border-line-input hover:border-fg aria-invalid:border-status-danger-line aria-invalid:hover:border-fg disabled:cursor-not-allowed disabled:border-line-faint disabled:bg-muted disabled:text-fg-disabled disabled:placeholder:text-fg-disabled";

export interface FieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** The control's visible name. */
  label: React.ReactNode;
  /** Help text under the control. */
  help?: React.ReactNode;
  /** What is wrong with the value; marks the control invalid. */
  error?: React.ReactNode;
  /** One Input, Textarea or Select. */
  children: React.ReactNode;
}

const shown = (node: React.ReactNode) => node !== undefined && node !== null && node !== false && node !== "";

function Field({ label, help, error, className, children, ...props }: FieldProps) {
  const base = React.useId();
  const [ownId, setOwnId] = React.useState<string | null>(null);
  const controlId = ownId ?? `${base}-control`;
  const labelId = `${base}-label`;
  const helpId = `${base}-help`;
  const errorId = `${base}-error`;
  const hasHelp = shown(help);
  const hasError = shown(error);
  const describedBy = [hasHelp ? helpId : null, hasError ? errorId : null].filter(Boolean).join(" ") || undefined;
  const value = React.useMemo<FieldContextValue>(
    () => ({ controlId, labelId, describedBy, invalid: hasError, registerId: setOwnId }),
    [controlId, labelId, describedBy, hasError],
  );
  return (
    <div data-slot="field" className={cn("flex flex-col gap-2", className)} {...props}>
      <Label id={labelId} htmlFor={controlId}>
        {label}
      </Label>
      <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
      {hasHelp ? (
        <p id={helpId} data-slot="field-help" className="text-caption text-fg-2">
          {help}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} data-slot="field-error" className="text-caption text-status-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface FieldControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-labelledby"?: string;
}

/**
 * The id, description and invalid state a control inside a Field takes
 * (spread after its own props). Outside a Field: nothing.
 */
function useFieldControl(
  props: FieldControlProps & { "aria-label"?: string },
  { labelledBy = false }: { labelledBy?: boolean } = {},
): FieldControlProps {
  const field = React.useContext(FieldContext);
  const register = field?.registerId;
  const ownId = props.id;
  React.useLayoutEffect(() => {
    if (!register || !ownId) return;
    register(ownId);
    return () => register(null);
  }, [register, ownId]);
  if (!field) return {};
  // A control named by its own aria-label or aria-labelledby keeps that name:
  // a generated aria-labelledby would take precedence over aria-label.
  const ownName = props["aria-labelledby"] ?? props["aria-label"];
  return {
    id: ownId ?? field.controlId,
    "aria-describedby": [props["aria-describedby"], field.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid ? true : undefined),
    ...(labelledBy && ownName == null ? { "aria-labelledby": field.labelId } : {}),
  };
}

export { Field, useFieldControl };
