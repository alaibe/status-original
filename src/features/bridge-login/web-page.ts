import type { CookiesParams } from '@/protocols/matrix/provisioning';

export interface WebLoginProps {
  params: CookiesParams;
  network: string;
  onValues: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export interface PageState {
  extracted: Record<string, string> | null;
  localStorage: Record<string, string>;
}

/** The readback script's answer; some webviews hand it over JSON-encoded a second time. */
export function parsePage(raw: string | null | undefined): PageState | null {
  if (!raw) return null;
  try {
    let value: unknown = JSON.parse(raw);
    if (typeof value === 'string') value = JSON.parse(value);
    return value && typeof value === 'object' ? (value as PageState) : null;
  } catch {
    return null;
  }
}
