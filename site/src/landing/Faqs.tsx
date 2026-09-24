import type { Root } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import Link from 'next/link';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

import { Container } from '@/landing/Container';
import { faqs } from '@/lib/docs';

const shown = [
  'i-lost-my-phone-is-my-account-gone',
  'why-does-the-app-start-almost-empty',
  'who-can-see-my-messages',
  'can-i-message-someone-on-whatsapp-or-signal',
  'does-the-app-collect-anything',
  'is-there-a-fee-on-sends-or-swaps',
  'can-an-ai-assistant-use-it',
  'can-i-swap-tokens-or-move-them-to-another-chain',
  'where-is-android',
];

function Answer({ tree }: { tree: Root }) {
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components: {
      a: ({ href = '', children }) =>
        /^[a-z]+:/i.test(href) ? (
          <a href={href} className="font-medium text-brand-600 hover:text-brand-500">
            {children}
          </a>
        ) : (
          <Link href={href} className="font-medium text-brand-600 hover:text-brand-500">
            {children}
          </Link>
        ),
      code: ({ children }) => (
        <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.8125rem] text-gray-900">
          {children}
        </code>
      ),
      strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
    },
  });
}

export function Faqs() {
  let items = faqs().filter((faq) => shown.includes(faq.id));
  let columns = [0, 1, 2].map((column) => items.filter((_, index) => index % 3 === column));

  return (
    <section
      id="faqs"
      aria-labelledby="faqs-title"
      className="border-t border-gray-200 py-20 sm:py-32">
      <Container>
        <div className="mx-auto max-w-2xl lg:mx-0">
          <h2 id="faqs-title" className="text-3xl font-medium tracking-tight text-gray-900">
            Frequently asked questions
          </h2>
          <p className="mt-2 text-lg text-gray-600">
            The rest are in the{' '}
            <Link href="/faq" className="text-gray-900 underline">
              full FAQ
            </Link>
            , and bugs go to{' '}
            <a
              href="https://github.com/alaibe/status-original/issues"
              className="text-gray-900 underline">
              GitHub issues
            </a>
            .
          </p>
        </div>
        <ul
          role="list"
          className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-8 sm:mt-20 lg:max-w-none lg:grid-cols-3">
          {columns.map((column, columnIndex) => (
            <li key={columnIndex}>
              <ul role="list" className="space-y-10">
                {column.map((faq) => (
                  <li key={faq.id}>
                    <h3 className="text-lg/6 font-semibold text-gray-900">{faq.question}</h3>
                    <div className="mt-4 space-y-3 text-sm text-gray-700">
                      <Answer tree={faq.answer} />
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
