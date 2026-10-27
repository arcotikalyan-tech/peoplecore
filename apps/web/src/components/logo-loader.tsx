/* eslint-disable @next/next/no-img-element -- a small static logo; next/image adds nothing here */

/** The people mark with an arc in its three colours turning round it (`.pc-loader` in globals.css). Decorative: the
 * caller says what is loading. */
export function LogoLoader({ label }: { label?: string }) {
  return (
    <div className="grid justify-items-center gap-3">
      <div className="pc-loader" aria-hidden="true">
        <img src="/brand/peoplecore-mark.png" alt="" width={64} height={64} />
      </div>
      {label && <p className="text-sm font-medium text-muted">{label}</p>}
    </div>
  );
}
