import { CheckCircle2, Circle, Loader2, Trash2 } from "lucide-react";

export const TASK_STATUS_CONFIG: Record<string, { icon: typeof Circle; color: string }> = {
  pending: { icon: Circle, color: "text-muted-foreground" },
  in_progress: { icon: Loader2, color: "text-info" },
  completed: { icon: CheckCircle2, color: "text-success" },
  deleted: { icon: Trash2, color: "text-destructive" },
};
