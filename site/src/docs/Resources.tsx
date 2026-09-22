'use client';

import { motion, useMotionTemplate, useMotionValue, type MotionValue } from 'framer-motion';
import Link from 'next/link';

import { GridPattern } from '@/docs/GridPattern';
import { Heading } from '@/docs/Heading';
import { BellIcon } from '@/docs/icons/BellIcon';
import { BoltIcon } from '@/docs/icons/BoltIcon';
import { ChatBubbleIcon } from '@/docs/icons/ChatBubbleIcon';
import { CogIcon } from '@/docs/icons/CogIcon';
import { EnvelopeIcon } from '@/docs/icons/EnvelopeIcon';
import { LinkIcon } from '@/docs/icons/LinkIcon';
import { ShapesIcon } from '@/docs/icons/ShapesIcon';
import { SquaresPlusIcon } from '@/docs/icons/SquaresPlusIcon';
import { UserIcon } from '@/docs/icons/UserIcon';
import { UsersIcon } from '@/docs/icons/UsersIcon';

interface Resource {
  href: string;
  name: string;
  description: string;
}

const icons: Record<string, React.ComponentType<{ className?: string }>> = {
  account: UserIcon,
  chats: ChatBubbleIcon,
  messages: EnvelopeIcon,
  networks: ShapesIcon,
  bridges: LinkIcon,
  wallet: BoltIcon,
  plugins: SquaresPlusIcon,
  settings: CogIcon,
  mac: UsersIcon,
};

const patterns: Array<
  Omit<React.ComponentPropsWithoutRef<typeof GridPattern>, 'width' | 'height' | 'x'>
> = [
  {
    y: 16,
    squares: [
      [0, 1],
      [1, 3],
    ],
  },
  {
    y: -6,
    squares: [
      [-1, 2],
      [1, 3],
    ],
  },
  {
    y: 32,
    squares: [
      [0, 2],
      [1, 4],
    ],
  },
  { y: 22, squares: [[0, 1]] },
];

function ResourceIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900/5 ring-1 ring-zinc-900/25 backdrop-blur-[2px] transition duration-300 group-hover:bg-white/50 group-hover:ring-zinc-900/25 dark:bg-white/7.5 dark:ring-white/15 dark:group-hover:bg-brand-300/10 dark:group-hover:ring-brand-400">
      <Icon className="h-5 w-5 fill-zinc-700/10 stroke-zinc-700 transition-colors duration-300 group-hover:stroke-zinc-900 dark:fill-white/10 dark:stroke-zinc-400 dark:group-hover:fill-brand-300/10 dark:group-hover:stroke-brand-400" />
    </div>
  );
}

function ResourcePattern({
  mouseX,
  mouseY,
  ...gridProps
}: (typeof patterns)[number] & {
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
}) {
  let maskImage = useMotionTemplate`radial-gradient(180px at ${mouseX}px ${mouseY}px, white, transparent)`;
  let style = { maskImage, WebkitMaskImage: maskImage };

  return (
    <div className="pointer-events-none">
      <div className="absolute inset-0 rounded-2xl mask-[linear-gradient(white,transparent)] transition duration-300 group-hover:opacity-50">
        <GridPattern
          width={72}
          height={56}
          x="50%"
          className="absolute inset-x-0 inset-y-[-30%] h-[160%] w-full skew-y-[-18deg] fill-black/2 stroke-black/5 dark:fill-white/1 dark:stroke-white/2.5"
          {...gridProps}
        />
      </div>
      <motion.div
        className="absolute inset-0 rounded-2xl bg-linear-to-r from-[#E3E6F8] to-[#F3EEFB] opacity-0 transition duration-300 group-hover:opacity-100 dark:from-[#1E2240] dark:to-[#2A2440]"
        style={style}
      />
      <motion.div
        className="absolute inset-0 rounded-2xl opacity-0 mix-blend-overlay transition duration-300 group-hover:opacity-100"
        style={style}>
        <GridPattern
          width={72}
          height={56}
          x="50%"
          className="absolute inset-x-0 inset-y-[-30%] h-[160%] w-full skew-y-[-18deg] fill-black/50 stroke-black/70 dark:fill-white/2.5 dark:stroke-white/10"
          {...gridProps}
        />
      </motion.div>
    </div>
  );
}

function Resource({ resource, index }: { resource: Resource; index: number }) {
  let mouseX = useMotionValue(0);
  let mouseY = useMotionValue(0);

  function onMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent<HTMLDivElement>) {
    let { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <div
      key={resource.href}
      onMouseMove={onMouseMove}
      className="group relative flex rounded-2xl bg-zinc-50 transition-shadow hover:shadow-md hover:shadow-zinc-900/5 dark:bg-white/2.5 dark:hover:shadow-black/5">
      <ResourcePattern {...patterns[index % patterns.length]} mouseX={mouseX} mouseY={mouseY} />
      <div className="absolute inset-0 rounded-2xl ring-1 ring-zinc-900/7.5 ring-inset group-hover:ring-zinc-900/10 dark:ring-white/10 dark:group-hover:ring-white/20" />
      <div className="relative rounded-2xl px-4 pt-16 pb-4">
        <ResourceIcon icon={icons[resource.href.split('/').pop() ?? ''] ?? BellIcon} />
        <h3 className="mt-4 text-sm/7 font-semibold text-zinc-900 dark:text-white">
          <Link href={resource.href}>
            <span className="absolute inset-0 rounded-2xl" />
            {resource.name}
          </Link>
        </h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{resource.description}</p>
      </div>
    </div>
  );
}

export function Resources({ resources }: { resources: Array<Resource> }) {
  return (
    <div className="my-16 xl:max-w-none">
      <Heading level={2} id="guides">
        The guide
      </Heading>
      <div className="not-prose mt-4 grid grid-cols-1 gap-8 border-t border-zinc-900/5 pt-10 sm:grid-cols-2 xl:grid-cols-3 dark:border-white/5">
        {resources.map((resource, index) => (
          <Resource key={resource.href} resource={resource} index={index} />
        ))}
      </div>
    </div>
  );
}
