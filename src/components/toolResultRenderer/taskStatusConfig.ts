import { CircleCheck, Circle, LoaderCircle, Trash } from "lucide-react";

export const TASK_STATUS_CONFIG: Record<string, { icon: typeof Circle; color: string }> = {
  pending: { icon: Circle, color: "text-muted-foreground" },
  in_progress: { icon: LoaderCircle, color: "text-info" },
  completed: { icon: CircleCheck, color: "text-success" },
  deleted: { icon: Trash, color: "text-destructive" },
};
