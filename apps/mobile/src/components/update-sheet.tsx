import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { downloadUpdate, installUpdate, UPDATE_PAGE } from '@/lib/app-update';
import { Banner, Button, ProgressBar, Sheet, space, Text } from '@/ui';

type Step = { at: 'downloading'; percent: number; total: number } | { at: 'ready'; file: string } | { at: 'failed' };

const STARTING: Step = { at: 'downloading', percent: 0, total: 0 };

/**
 * Updates the app from inside it: the new version downloads here, then Android's own install screen opens to confirm
 * it. Android allows no more than that outside a store. Closing the sheet cancels the download.
 */
export function UpdateSheet({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>(STARTING);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const download = downloadUpdate((written, total) => {
      const percent = Math.floor((written / total) * 100);
      setStep((now) => (now.at === 'downloading' && now.percent === percent ? now : { at: 'downloading', percent, total }));
    });
    void download.done.then(async (file) => {
      if (!file) return;
      setStep({ at: 'ready', file });
      await installUpdate(file);
    }).catch(() => setStep({ at: 'failed' }));
    return download.cancel;
  }, [attempt]);

  const retry = () => { setStep(STARTING); setAttempt((n) => n + 1); };

  return (
    <Sheet visible onClose={onClose} title="Update PeopleCore">
      {step.at === 'downloading' && (
        <View style={{ gap: space.md }}>
          <Text variant="callout" tone="muted">
            {step.total ? `Downloading: ${Math.round((step.percent / 100) * step.total / 1_000_000)} of ${Math.round(step.total / 1_000_000)} MB` : 'Starting the download…'}
          </Text>
          <ProgressBar value={step.percent} label="Downloading the new version" />
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
      )}
      {step.at === 'ready' && (
        <View style={{ gap: space.md }}>
          <Text variant="callout" tone="muted">Tap Update on Android’s screen to finish. You stay signed in and nothing is lost.</Text>
          <Text variant="footnote" tone="muted">The first time, Android asks to allow installs from PeopleCore: tap Settings, turn on Allow from this source and go back.</Text>
          <Text variant="footnote" tone="muted">If Google Play Protect asks, tap More details, then Install without scanning or Install anyway.</Text>
          <View style={{ gap: space.sm }}>
            <Button label="Install update" onPress={() => void installUpdate(step.file).catch(() => setStep({ at: 'failed' }))} />
            <Button label="Not now" variant="ghost" onPress={onClose} />
          </View>
        </View>
      )}
      {step.at === 'failed' && (
        <View style={{ gap: space.md }}>
          <Banner tone="danger" text="The update didn’t finish. Check your connection and try again." />
          <View style={{ gap: space.sm }}>
            <Button label="Try again" onPress={retry} />
            <Button label="Use the download page" variant="ghost" onPress={() => { void Linking.openURL(UPDATE_PAGE); onClose(); }} />
          </View>
        </View>
      )}
    </Sheet>
  );
}
