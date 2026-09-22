import type { Metadata } from 'next';

import { Button } from '@/docs/Button';
import { Heading } from '@/docs/Heading';
import { HeroPattern } from '@/docs/HeroPattern';
import { Prose } from '@/docs/Prose';
import { Resources } from '@/docs/Resources';
import { getPage } from '@/lib/docs';
import { navigation } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Introduction',
  description: 'How to use Status Original, the self-custodial messenger.',
};

export default function Introduction() {
  let guides = navigation[0].links
    .filter((link) => link.href !== '/guide')
    .map((link) => {
      let page = getPage(link.href.slice(1));
      return { href: link.href, name: link.title, description: page.description };
    });

  return (
    <article className="flex h-full flex-col pt-16 pb-10">
      <HeroPattern />
      <Prose className="flex-auto">
        <h1>Status Original guide</h1>
        <p className="lead">
          Status Original is a messenger with no company in the middle. Your account is twelve words
          on your device: no sign-up, no phone number, no email. This guide covers everything the
          app does, screen by screen.
        </p>
        <div className="not-prose mt-6 mb-16 flex gap-3">
          <Button href="/guide/account" arrow="right">
            Create your account
          </Button>
          <Button href="/guide/networks" variant="outline">
            Connect a network
          </Button>
        </div>
        <Heading level={2} id="what-it-costs-you" anchor={false}>
          What it costs you
        </Heading>
        <p className="lead">
          Nobody can reset your account. Write the twelve words down and keep them offline. Lose
          them and the account is gone, and the app says exactly that on the screen where it first
          shows them to you.
        </p>
        <div className="not-prose">
          <Button href="/faq" variant="text" arrow="right">
            Read the FAQ
          </Button>
        </div>
        <Resources resources={guides} />
      </Prose>
    </article>
  );
}
