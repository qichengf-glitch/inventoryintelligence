/**
 * Excludes rows where ALL key numeric inventory columns are zero or null.
 * A row is only kept if at least one of the provided value columns is > 0.
 * This prevents placeholder / all-zero SKU or batch rows from polluting any
 * system feature (search, alerts, forecasting, dashboard, analytics, AI context).
 *
 * Note: month_in / month_out are NOT included by default because many tables
 * (e.g. inventory_summary) do not have those columns, which would cause a
 * Postgres "column does not exist" error.  Pass them via extraCols only when
 * you know the underlying table contains them.
 */
export function excludeAllZeroRows(
  query: any,
  salesCol: string,
  stockCol?: string,
  extraCols?: string[]
): any {
  const filters = [
    `${salesCol}.gt.0`,
    stockCol ? `${stockCol}.gt.0` : null,
    ...(extraCols ?? []).map((col) => `${col}.gt.0`),
  ].filter(Boolean);

  return query.or(filters.join(","));
}
