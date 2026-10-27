import { LogoLoader } from '@/components/logo-loader';

export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="grid min-h-[50vh] place-items-center">
      <LogoLoader label="Loading…" />
    </div>
  );
}
