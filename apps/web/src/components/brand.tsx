/* eslint-disable @next/next/no-img-element -- a small static logo; next/image adds nothing here */

/** The PeopleCore logo: the people mark (public/brand) and the name, set as text so it reads in light and dark. */
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-fg">
      <img src="/brand/peoplecore-mark.png" alt="" width={64} height={64} className="size-8 shrink-0" />
      <span>
        People<span className="text-brand">Core</span>
      </span>
    </span>
  );
}

/** Just the people mark, for tight spaces (the collapsed sidebar). */
export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return <img src="/brand/peoplecore-mark.png" alt="" width={64} height={64} className={`${className} shrink-0`} />;
}
