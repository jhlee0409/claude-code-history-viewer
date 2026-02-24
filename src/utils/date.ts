export interface DateFilterLike {
  start: Date | null;
  end: Date | null;
}

export function normalizeDateFilterOptions(
  dateFilter: DateFilterLike
): { start_date?: string; end_date?: string } {
  const startDate =
    dateFilter.start != null ? dateFilter.start.toISOString() : undefined;
  const endDateObj =
    dateFilter.end != null ? new Date(dateFilter.end) : null;

  if (endDateObj != null) {
    endDateObj.setHours(23, 59, 59, 999);
  }

  return {
    start_date: startDate,
    end_date: endDateObj?.toISOString(),
  };
}
