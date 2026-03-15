/**
 * Excludes rows where ALL key numeric inventory columns are zero or null.
 * A row is only kept if at least one of: sales, stock, month_in, month_out is > 0.
 * This prevents placeholder / all-zero SKU or batch rows from polluting any
 * system feature (search, alerts, forecasting, dashboard, analytics, AI context).
 */
export function excludeAllZeroRows(
  query: any,
  salesCol: string,
  stockCol: string
): any {
  return query.or(
    `${salesCol}.gt.0,${stockCol}.gt.0,month_in.gt.0,month_out.gt.0`
  );
}
