'use client';

import clsx from 'clsx';
import { useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { Container } from '@/landing/Container';
import { basePath } from '@/lib/site';

const screens = [
  ['chats', 'The chat list'],
  ['status-room', 'The Status room'],
  ['wallet', 'The Wallet room'],
  ['protocols', 'Settings → Protocols'],
  ['message-actions', 'Reactions, reply, copy, forward'],
  ['plugins', 'Settings → Plugins'],
  ['new-chat', 'Starting a new chat'],
  ['privacy', 'Settings → Privacy'],
  ['protocol-matrix', 'Matrix settings'],
  ['wallet-send', 'The send form'],
  ['contacts', 'Contacts'],
  ['settings', 'Settings'],
  ['protocol-telegram', 'Telegram settings'],
  ['welcome', 'The welcome screen'],
  ['recovery-phrase-hidden', 'The recovery phrase'],
] as const;

type Screen = (typeof screens)[number];

function splitArray<T>(array: ReadonlyArray<T>, numParts: number) {
  let result: Array<Array<T>> = [];
  for (let i = 0; i < array.length; i++) {
    let index = i % numParts;
    result[index] ??= [];
    result[index].push(array[i]);
  }
  return result;
}

function Shot({
  screen: [name, caption],
  className,
  ...props
}: { screen: Screen } & React.ComponentPropsWithoutRef<'figure'>) {
  return (
    <figure
      className={clsx(
        'animate-fade-in overflow-hidden rounded-[2.25rem] bg-white p-2 opacity-0 shadow-xl ring-1 shadow-gray-900/10 ring-gray-900/5',
        className
      )}
      {...props}>
      <img
        src={`${basePath}/screenshots/${name}.png`}
        alt={caption}
        loading="lazy"
        className="aspect-660/1435 w-full rounded-[1.75rem] object-cover object-top"
      />
    </figure>
  );
}

function Column({
  screens,
  className,
  shotClassName,
  msPerPixel = 0,
}: {
  screens: Array<Screen>;
  className?: string;
  shotClassName?: (index: number) => string;
  msPerPixel?: number;
}) {
  let columnRef = useRef<React.ComponentRef<'div'>>(null);
  let [columnHeight, setColumnHeight] = useState(0);
  let duration = `${columnHeight * msPerPixel}ms`;

  useEffect(() => {
    if (!columnRef.current) return;
    let resizeObserver = new window.ResizeObserver(() => {
      setColumnHeight(columnRef.current?.offsetHeight ?? 0);
    });
    resizeObserver.observe(columnRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div
      ref={columnRef}
      className={clsx(
        'animate-marquee space-y-8 py-4 hover:[animation-play-state:paused]',
        className
      )}
      style={{ '--marquee-duration': duration } as React.CSSProperties}>
      {screens.concat(screens).map((screen, index) => (
        <Shot
          key={index}
          screen={screen}
          aria-hidden={index >= screens.length}
          className={shotClassName?.(index % screens.length)}
        />
      ))}
    </div>
  );
}

function Grid() {
  let containerRef = useRef<React.ComponentRef<'div'>>(null);
  let isInView = useInView(containerRef, { once: true, amount: 0.4 });
  let columns = splitArray(screens, 3);
  let column1 = columns[0];
  let column2 = columns[1];
  let column3 = splitArray(columns[2], 2);

  return (
    <div
      ref={containerRef}
      className="relative -mx-4 mt-16 grid h-196 max-h-[150vh] grid-cols-1 items-start gap-8 overflow-hidden px-4 sm:mt-20 sm:grid-cols-2 lg:grid-cols-3">
      {isInView && (
        <>
          <Column
            screens={[...column1, ...column3.flat(), ...column2]}
            shotClassName={(index) =>
              clsx(
                index >= column1.length + column3[0].length && 'sm:hidden',
                index >= column1.length && 'lg:hidden'
              )
            }
            className="mx-auto w-full max-w-72"
            msPerPixel={12}
          />
          <Column
            screens={[...column2, ...column3[1]]}
            className="mx-auto hidden w-full max-w-72 sm:block"
            shotClassName={(index) => (index >= column2.length ? 'lg:hidden' : '')}
            msPerPixel={18}
          />
          <Column
            screens={column3.flat()}
            className="mx-auto hidden w-full max-w-72 lg:block"
            msPerPixel={12}
          />
        </>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-gray-50" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-gray-50" />
    </div>
  );
}

export function Screens() {
  return (
    <section id="tour" aria-labelledby="tour-title" className="pt-20 pb-16 sm:pt-32 sm:pb-24">
      <Container>
        <h2
          id="tour-title"
          className="text-3xl font-medium tracking-tight text-gray-900 sm:text-center">
          Have a look around.
        </h2>
        <p className="mt-2 text-lg text-gray-600 sm:text-center">
          Every screen below is the app as it ships, on an iPhone.
        </p>
        <Grid />
      </Container>
    </section>
  );
}
