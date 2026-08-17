/** Shared USD/date formatting so the same Shipment fields render identically
 * wherever they're shown (Atlas popup, Manage > Shipments, ...) instead of
 * each call site hand-rolling its own toLocaleString options. */

export function formatCurrencyUsd(value: number | null | undefined): string {
  if (value == null) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
}
