/**
 * A widget is data: it can be stored in a transcript, summarised for the chat
 * list, sent to a peer, and rendered by a host that has never heard of the
 * plugin that produced it, none of which a React element could do. Keep the
 * union additive: an older build must be able to skip a node it does not
 * recognise without the message collapsing.
 */
import type { IconName } from '../icon';

export type WidgetTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

export interface WidgetAction {
  label: string;
  command: string;
  tone?: WidgetTone;
  icon?: IconName;
}

export interface WidgetRow {
  label: string;
  value: string;
  tone?: WidgetTone;
  state?: 'on' | 'off';
  actions?: WidgetAction[];
}

export interface WidgetListItem {
  title: string;
  subtitle?: string;
  icon?: IconName;
  tone?: WidgetTone;
  status?: string;
  state?: 'on' | 'off';
  actions?: WidgetAction[];
}

export interface WidgetOption {
  label: string;
  value: string;
  when?: Record<string, string>;
}

export interface WidgetField {
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  keyboard?: 'default' | 'decimal';
  hint?: string;
  optional?: boolean;
  options?: WidgetOption[];
  /** Options behind a picker instead of a row of chips, for lists that grow. */
  select?: boolean;
}

export type Widget =
  | {
      kind: 'stat';
      value: string;
      label?: string;
      caption?: string;
      tone?: WidgetTone;
      actions?: WidgetAction[];
    }
  | { kind: 'rows'; rows: WidgetRow[] }
  | { kind: 'list'; items: WidgetListItem[] }
  | { kind: 'text'; text: string }
  | { kind: 'code'; value: string; label?: string; copyable?: boolean }
  | { kind: 'card'; title?: string; icon?: IconName; tone?: WidgetTone; children: Widget[] }
  | { kind: 'badges'; badges: { label: string; tone?: WidgetTone }[] }
  | { kind: 'actions'; actions: WidgetAction[] }
  | { kind: 'link'; label: string; url: string; icon?: IconName }
  | { kind: 'form'; fields: WidgetField[]; submit: WidgetAction };

export const W = {
  stat: (value: string, opts: Omit<Extract<Widget, { kind: 'stat' }>, 'kind' | 'value'> = {}) =>
    ({ kind: 'stat', value, ...opts }) satisfies Widget,

  rows: (rows: WidgetRow[]) => ({ kind: 'rows', rows }) satisfies Widget,

  list: (items: WidgetListItem[]) => ({ kind: 'list', items }) satisfies Widget,

  text: (text: string) => ({ kind: 'text', text }) satisfies Widget,

  code: (value: string, opts: { label?: string; copyable?: boolean } = {}) =>
    ({ kind: 'code', value, copyable: true, ...opts }) satisfies Widget,

  card: (children: Widget[], opts: { title?: string; icon?: IconName; tone?: WidgetTone } = {}) =>
    ({ kind: 'card', children, ...opts }) satisfies Widget,

  badges: (badges: Extract<Widget, { kind: 'badges' }>['badges']) =>
    ({ kind: 'badges', badges }) satisfies Widget,

  actions: (actions: WidgetAction[]) => ({ kind: 'actions', actions }) satisfies Widget,

  link: (label: string, url: string, icon?: IconName) =>
    ({ kind: 'link', label, url, icon }) satisfies Widget,

  form: (fields: WidgetField[], submit: WidgetAction) =>
    ({ kind: 'form', fields, submit }) satisfies Widget,
} as const;

export function summariseWidget(widget: Widget): string {
  switch (widget.kind) {
    case 'stat':
      return [widget.label, widget.value].filter(Boolean).join(': ');
    case 'rows':
      return widget.rows.map((r) => `${r.label}: ${r.value}`).join(' · ');
    case 'list':
      return widget.items.map((i) => i.title).join(' · ');
    case 'text':
      return widget.text;
    case 'code':
      return widget.label ? `${widget.label}: ${widget.value}` : widget.value;
    case 'card':
      return [widget.title, ...widget.children.map(summariseWidget)].filter(Boolean).join(' · ');
    case 'badges':
      return widget.badges.map((b) => b.label).join(' · ');
    case 'actions':
      return widget.actions.map((a) => a.label).join(' · ');
    case 'link':
      return widget.label;
    case 'form':
      return [widget.submit.label, ...widget.fields.map((f) => f.label)].join(' · ');
  }
}

export function fillCommand(command: string, values: Record<string, string>): string {
  return command.replace(/\{(\w+)\}/g, (_, id: string) => {
    const value = (values[id] ?? '').trim();
    return /\s/.test(value) ? `"${value}"` : value;
  });
}

export function visibleOptions(
  field: WidgetField,
  values: Record<string, string>
): WidgetOption[] {
  return (field.options ?? []).filter(
    (option) =>
      !option.when || Object.entries(option.when).every(([id, value]) => values[id] === value)
  );
}

export function displayValues(
  fields: WidgetField[],
  values: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => {
      const chosen = field.options?.find(
        (option) =>
          option.value === values[field.id] &&
          (!option.when || Object.entries(option.when).every(([id, value]) => values[id] === value))
      );
      return [field.id, chosen?.label ?? values[field.id] ?? ''];
    })
  );
}

export function fillText(text: string, display: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, id: string) => display[id] || whole);
}

export function resolveValues(
  fields: WidgetField[],
  values: Record<string, string>
): Record<string, string> {
  let out = values;
  for (const field of fields) {
    if (!field.options) continue;
    const visible = visibleOptions(field, out);
    if (visible.length === 0) continue;
    if (!visible.some((option) => option.value === out[field.id])) {
      out = { ...out, [field.id]: visible[0].value };
    }
  }
  return out;
}
