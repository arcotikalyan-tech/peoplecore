import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Download, KeyRound, PackageCheck, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { buttonClass } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { publicOriginFromHeaders } from '@/lib/public-origin';
import { latestAndroidApp } from '@/server/android-app';

export const metadata: Metadata = {
  title: 'Android app',
  description: 'Download the PeopleCore app for Android: check in, apply for leave, see payslips and approve requests.',
  robots: { index: false, follow: false },
};

const STEPS = [
  { icon: Download, t: 'Download', b: 'Tap Download on your Android phone. If Chrome says this type of file can harm your device, tap Download anyway: it comes straight from PeopleCore.' },
  { icon: PackageCheck, t: 'Install', b: 'Open the file from the notification. The first time, Android asks to allow installs from your browser: tap Settings, turn on Allow from this source and go back. If Google Play Protect asks, tap More details, then Install without scanning or Install anyway.' },
  { icon: KeyRound, t: 'Sign in', b: 'Open PeopleCore and sign in with your work email and password, the same as on the website.' },
];

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(0)} MB`;

/**
 * Where the team gets the Android app (deploy/publish-android.sh puts each new build here): download, a QR code to
 * open this page on a phone, and how to install. Public, like a store listing; the app itself needs a sign-in.
 */
export default async function AndroidAppPage() {
  const [app, origin] = await Promise.all([latestAndroidApp(), headers().then(publicOriginFromHeaders)]);
  const here = `${origin ?? 'https://hrms.tazq.io'}/android`;
  const qr = app ? await QRCode.toString(here, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) : null;

  return (
    <div className="min-h-dvh overflow-x-clip bg-canvas text-fg">
      <SiteHeader />
      <main>
        <section className="relative isolate border-b border-line">
          <div aria-hidden="true" className="pc-grid-bg absolute inset-0 -z-10" />
          <div aria-hidden="true" className="pc-blob pc-blob-a -z-10 left-[-12%] top-[-30%] size-[28rem] opacity-40" />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="pc-rise text-sm font-medium text-primary">Android app</p>
              <h1 className="pc-rise mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl" style={{ animationDelay: '80ms' }}>PeopleCore on your phone</h1>
              <p className="pc-rise mt-4 max-w-xl text-lg text-muted" style={{ animationDelay: '160ms' }}>
                Check in and out, apply for leave, see your payslips and approve your team’s requests.
              </p>
              {app ? (
                <div className="pc-rise mt-8" style={{ animationDelay: '240ms' }}>
                  <a href="/android/download" download={app.file} className={buttonClass('primary', 'md', 'h-12 px-6 text-base')}>
                    <Download className="size-5" aria-hidden="true" /> Download for Android
                  </a>
                  <p className="mt-3 text-sm text-muted">
                    Version {app.versionCode} · {mb(app.size)} · published {formatDateTime(app.publishedAt, 'Asia/Kolkata')}
                  </p>
                </div>
              ) : (
                <p role="status" className="mt-8 max-w-xl rounded-xl border border-line bg-surface p-4 text-muted">
                  The Android app isn’t published here yet. Check back soon, or use PeopleCore in your phone’s browser meanwhile.
                </p>
              )}
            </div>
            {qr && (
              <figure className="hidden rounded-2xl border border-line bg-surface p-5 text-center md:block">
                {/* The QR code is drawn black on white, so it stays scannable in the dark theme too. */}
                <div className="size-48 rounded-xl bg-white p-3 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
                <figcaption className="mt-3 max-w-48 text-sm text-muted">On a computer? Scan this with your phone’s camera.</figcaption>
              </figure>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-xl font-semibold">Installing</h2>
          <ol className="mt-5 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.t} className="flex gap-4 rounded-2xl border border-line bg-surface p-6">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><s.icon className="size-5" aria-hidden="true" /></span>
                <div>
                  <h3 className="font-semibold">{i + 1}. {s.t}</h3>
                  <p className="mt-2 text-sm text-muted">{s.b}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex gap-4 rounded-2xl border border-line bg-surface p-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><RefreshCw className="size-5" aria-hidden="true" /></span>
            <div>
              <h3 className="font-semibold">Updates</h3>
              <p className="mt-2 text-sm text-muted">
                When there’s a new version, the app shows <strong className="font-medium text-fg">Update PeopleCore</strong> on its Home screen. Tap it, and
                the app downloads the update and opens Android’s install screen to confirm: you stay signed in and nothing is lost. Android only for now; on an
                iPhone, use PeopleCore in Safari.
              </p>
            </div>
          </div>
          {app && (
            <p className="mt-6 break-all text-xs text-muted">
              Build {app.commit.slice(0, 7)} · SHA-256 {app.sha256}
            </p>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
