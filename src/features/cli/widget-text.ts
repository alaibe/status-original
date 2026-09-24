import type { Widget, WidgetAction } from '@/design/widgets';
import type { MessageContent } from '@/core/messaging/types';

function actionLines(
  actions: WidgetAction[] | undefined,
  indent: string,
  run: (command: string) => string
) {
  return (actions ?? []).map((a) => `${indent}→ ${a.label}: ${run(a.command)}`);
}

/** A widget as terminal lines. Buttons become the command that pressing them would run. */
export function widgetLines(
  widget: Widget,
  run: (command: string) => string,
  indent = ''
): string[] {
  switch (widget.kind) {
    case 'stat':
      return [
        `${indent}${[widget.label, widget.value].filter(Boolean).join(': ')}`,
        ...(widget.caption ? [`${indent}${widget.caption}`] : []),
        ...actionLines(widget.actions, indent, run),
      ];
    case 'rows':
      return widget.rows.flatMap((r) => [
        `${indent}${r.label}: ${r.value}`,
        ...actionLines(r.actions, `${indent}  `, run),
      ]);
    case 'list':
      return widget.items.flatMap((item) => [
        `${indent}• ${item.title}${item.subtitle ? ` — ${item.subtitle}` : ''}${item.status ? ` (${item.status})` : ''}`,
        ...actionLines(item.actions, `${indent}  `, run),
      ]);
    case 'text':
      return widget.text.split('\n').map((line) => `${indent}${line}`);
    case 'code':
      return [`${indent}${widget.label ? `${widget.label}: ` : ''}${widget.value}`];
    case 'card':
      return [
        ...(widget.title ? [`${indent}${widget.title}`] : []),
        ...widget.children.flatMap((child) =>
          widgetLines(child, run, widget.title ? `${indent}  ` : indent)
        ),
      ];
    case 'badges':
      return [`${indent}${widget.badges.map((b) => `[${b.label}]`).join(' ')}`];
    case 'actions':
      return actionLines(widget.actions, indent, run);
    case 'link':
      return [`${indent}${widget.label}: ${widget.url}`];
    case 'form':
      return [
        `${indent}${widget.submit.label}: ${run(widget.submit.command)}`,
        ...widget.fields.map(
          (f) =>
            `${indent}  {${f.id}} ${f.label}${f.optional ? ' (optional)' : ''}` +
            (f.options?.length ? `: ${f.options.map((o) => o.value).join(' | ')}` : '')
        ),
      ];
    default:
      return [];
  }
}

export function contentLines(content: MessageContent, run: (command: string) => string): string[] {
  if (content.kind === 'widget') return widgetLines(content.widget, run);
  if (content.kind === 'text' || content.kind === 'system') return content.text.split('\n');
  if (content.kind === 'custom' || content.kind === 'unsupported') return [content.fallback ?? ''];
  return [];
}
