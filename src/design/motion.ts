import {
  Easing,
  FadeIn,
  LinearTransition,
  FadeInDown,
  FadeInUp,
  FadeOut,
  ReduceMotion,
  SlideInDown,
  SlideOutDown,
  type WithSpringConfig,
} from 'react-native-reanimated';

const R = ReduceMotion.System;

export const Spring = {
  press: {
    damping: 28,
    stiffness: 320,
    mass: 0.6,
    overshootClamping: true,
    reduceMotion: R,
  } satisfies WithSpringConfig,

  surface: {
    damping: 30,
    stiffness: 220,
    mass: 1,
    overshootClamping: true,
    reduceMotion: R,
  } satisfies WithSpringConfig,

  layout: {
    damping: 27,
    stiffness: 200,
    mass: 0.9,
    overshootClamping: true,
    reduceMotion: R,
  } satisfies WithSpringConfig,
} as const;

export function springLayout(preset: WithSpringConfig = Spring.layout) {
  return LinearTransition.springify()
    .damping(preset.damping!)
    .stiffness(preset.stiffness!)
    .mass(preset.mass!)
    .reduceMotion(R);
}

const EASE_OUT = Easing.out(Easing.cubic);

export const Duration = {
  fast: 130,
  base: 200,
  slow: 300,
} as const;

export const Enter = {
  content: (delay = 0) =>
    FadeInDown.duration(Duration.base)
      .easing(EASE_OUT)
      .withInitialValues({ transform: [{ translateY: 10 }] })
      .delay(delay)
      .reduceMotion(R),

  row: (delay = 0) =>
    FadeInDown.duration(Duration.fast)
      .easing(EASE_OUT)
      .withInitialValues({ transform: [{ translateY: 5 }] })
      .delay(delay)
      .reduceMotion(R),

  fade: (delay = 0) =>
    FadeIn.duration(Duration.base).easing(EASE_OUT).delay(delay).reduceMotion(R),

  fromTop: () =>
    FadeInUp.duration(Duration.base)
      .easing(EASE_OUT)
      .withInitialValues({ transform: [{ translateY: -12 }] })
      .reduceMotion(R),

  fromBottom: () =>
    FadeInDown.duration(Duration.base)
      .easing(EASE_OUT)
      .withInitialValues({ transform: [{ translateY: 16 }] })
      .reduceMotion(R),

  sheet: () =>
    SlideInDown.springify()
      .damping(Spring.surface.damping)
      .stiffness(Spring.surface.stiffness)
      .mass(Spring.surface.mass)
      .reduceMotion(R),
} as const;

export const Exit = {
  fade: () => FadeOut.duration(Duration.fast).reduceMotion(R),
  sheet: () => SlideOutDown.duration(Duration.base).easing(Easing.in(Easing.cubic)).reduceMotion(R),
} as const;

export function stagger(index: number, step = 16, max = 120) {
  return Math.min(index * step, max);
}
