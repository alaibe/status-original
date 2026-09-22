'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const steps = [900, 1400, 1300, 1100, 1600, 1500, 3800];

function Bubble({
  from,
  children,
  className,
}: {
  from: 'me' | 'them';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', duration: 0.45, bounce: 0.25 }}
      className={clsx(
        'max-w-[78%] rounded-2xl px-3 py-2 text-[11px]/4',
        from === 'me'
          ? 'self-end rounded-br-md bg-brand-600 text-white'
          : 'self-start rounded-bl-md bg-white text-gray-900 shadow-sm shadow-gray-900/5',
        className
      )}>
      {children}
    </motion.div>
  );
}

function Typing() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex gap-1 self-start rounded-2xl rounded-bl-md bg-white px-3 py-2.5 shadow-sm shadow-gray-900/5">
      {[0, 0.15, 0.3].map((delay) => (
        <motion.span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-gray-400"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.9, repeat: Infinity, delay }}
        />
      ))}
    </motion.div>
  );
}

function RequestCard({ paid, reacted }: { paid: boolean; reacted: boolean }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', duration: 0.45, bounce: 0.25 }}
      className="relative w-[78%] self-end">
      <div className="overflow-hidden rounded-2xl rounded-br-md bg-white shadow-md ring-1 shadow-gray-900/10 ring-gray-900/5">
        <div className="flex items-center gap-1.5 px-3 pt-2.5 text-[9px] font-semibold tracking-wide text-gray-500 uppercase">
          <svg viewBox="0 0 16 16" className="h-3 w-3 fill-brand-600" aria-hidden="true">
            <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5V5H2v-.5ZM2 6.5h12v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-5Zm8 3a.75.75 0 0 0 0 1.5h2a.75.75 0 0 0 0-1.5h-2Z" />
          </svg>
          Payment request
        </div>
        <div className="px-3 pt-1 pb-2.5">
          <p className="text-xl font-semibold tracking-tight text-gray-900">30 USDC</p>
          <p className="text-[10px] text-gray-500">dinner · on Base</p>
        </div>
        <div className="border-t border-gray-100 px-3 py-2">
          <AnimatePresence mode="wait" initial={false}>
            {paid ? (
              <motion.p
                key="paid"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-center gap-1 text-[11px] font-semibold text-emerald-600">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm2.97 4.72a.75.75 0 0 1 .06 1.06l-3.25 3.6a.75.75 0 0 1-1.1.02L5.03 9.2a.75.75 0 1 1 1.08-1.04l1.09 1.13 2.71-3.01a.75.75 0 0 1 1.06-.06Z" />
                </svg>
                Paid by Maya
              </motion.p>
            ) : (
              <motion.p
                key="pending"
                exit={{ opacity: 0, y: -4 }}
                className="text-center text-[11px] font-medium text-gray-400">
                Waiting for Maya
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>
        {reacted && (
          <motion.span
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.6 }}
            className="absolute -bottom-2.5 -left-2 rounded-full bg-white px-1.5 py-0.5 text-[11px] shadow ring-1 ring-gray-900/5">
            🙏
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function AppDemo() {
  let [step, setStep] = useState(0);

  useEffect(() => {
    let timeout = window.setTimeout(
      () => setStep((step) => (step + 1) % steps.length),
      steps[step]
    );
    return () => window.clearTimeout(timeout);
  }, [step]);

  return (
    <div className="col-start-1 row-start-1 flex flex-col bg-[#f2f2f7]">
      <div className="flex items-center justify-between px-6 pt-2.5 text-[11px] font-semibold text-gray-900">
        <span>9:41</span>
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 18 12" className="h-2.5 w-3.5 fill-gray-900" aria-hidden="true">
            <path d="M1 8h2v3H1zM5 6h2v5H5zM9 4h2v7H9zM13 1h2v10h-2z" />
          </svg>
          <span className="h-2.5 w-5 rounded-[3px] border border-gray-900/40 p-px">
            <span className="block h-full w-3/4 rounded-[1.5px] bg-gray-900" />
          </span>
        </span>
      </div>
      <div className="mx-3 mt-3 flex items-center gap-2 rounded-full bg-white/80 px-2 py-1.5 shadow-sm shadow-gray-900/5 backdrop-blur">
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 flex-none stroke-brand-600"
          fill="none"
          aria-hidden="true">
          <path d="M10 3 5 8l5 5" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-linear-to-br from-amber-300 to-rose-400 text-[11px] font-semibold text-white">
          M
        </span>
        <span className="min-w-0">
          <span className="block text-[12px]/4 font-semibold text-gray-900">Maya</span>
          <span className="flex items-center gap-1 text-[9px]/3 text-gray-500">
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-emerald-500" aria-hidden="true">
              <path d="M6 1a2.5 2.5 0 0 0-2.5 2.5V5H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-.5V3.5A2.5 2.5 0 0 0 6 1Zm1.5 4v-1.5a1.5 1.5 0 1 0-3 0V5h3Z" />
            </svg>
            XMTP · end-to-end encrypted
          </span>
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-start gap-2 overflow-hidden px-3 pt-5 pb-3">
        <p className="self-center text-[9px] font-medium text-gray-400">Today</p>
        <Bubble from="them">That dinner was so good 🍝</Bubble>
        <Bubble from="them">What do I owe you?</Bubble>
        {step >= 1 && <Bubble from="me">Splitting it, one sec</Bubble>}
        {step >= 2 && <RequestCard reacted={step >= 3} paid={step >= 5} />}
        <AnimatePresence>{step === 4 && <Typing key="typing" />}</AnimatePresence>
        {step >= 5 && (
          <Bubble from="them" className="mt-1">
            Sent! Next one’s on me
          </Bubble>
        )}
      </div>
      <div className="flex gap-1.5 overflow-hidden px-3 pb-2">
        {['Commands', 'Balance', 'Send', 'Request'].map((chip) => (
          <span
            key={chip}
            className={clsx(
              'flex-none rounded-full px-2.5 py-1 text-[10px] font-medium ring-1',
              chip === 'Request' && step === 1
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-white text-gray-700 ring-gray-900/10'
            )}>
            {chip}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 pb-6">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white ring-1 ring-gray-900/10">
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 stroke-gray-500"
            fill="none"
            aria-hidden="true">
            <path d="M8 3v10M3 8h10" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <span className="flex h-7 flex-1 items-center rounded-full bg-white px-3 text-[11px] ring-1 ring-gray-900/10">
          {step === 1 ? (
            <span className="text-gray-900">
              /request 30 dinner
              <motion.span
                className="ml-px inline-block h-3 w-px translate-y-0.5 bg-brand-600"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.6, repeat: Infinity }}
              />
            </span>
          ) : (
            <span className="text-gray-400">Message</span>
          )}
        </span>
      </div>
    </div>
  );
}
