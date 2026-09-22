import { Download } from '@/landing/Download';
import { Faqs } from '@/landing/Faqs';
import { Hero } from '@/landing/Hero';
import { PrimaryFeatures } from '@/landing/PrimaryFeatures';
import { Screens } from '@/landing/Screens';
import { SecondaryFeatures } from '@/landing/SecondaryFeatures';
import { getRelease } from '@/lib/release';

export default async function Home() {
  let release = await getRelease();

  return (
    <>
      <Hero release={release} />
      <PrimaryFeatures />
      <SecondaryFeatures />
      <Screens />
      <Download release={release} />
      <Faqs />
    </>
  );
}
