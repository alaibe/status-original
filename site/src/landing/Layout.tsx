import { Footer } from '@/landing/Footer';
import { Header } from '@/landing/Header';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex-auto">{children}</main>
      <Footer />
    </>
  );
}
