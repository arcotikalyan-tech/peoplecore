import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { classify, classifyHttp, PunchQueue, type QueuedPunch } from './punch-queue';
import { SITE_URL } from './site';
import { supabase } from './supabase';
import { within } from './timeout';

/** The device's queue (AsyncStorage) and how a punch reaches the server (record_punch, method 'mobile'). */
export const queue = new PunchQueue(AsyncStorage);

/** A punch that hasn't reached the server within 30 seconds stays queued and is tried again at the next sync. */
export function sendPunch(p: QueuedPunch) {
  return within(send(p), 30_000, classify({ message: 'network' }));
}

async function send(p: QueuedPunch) {
  if (p.photoUri) return sendWithPhoto(p, p.photoUri);
  try {
    const { error } = await supabase.rpc('record_punch', {
      p_client_id: p.clientId, p_punched_at: p.punchedAt, p_method: 'mobile',
      p_latitude: p.latitude, p_longitude: p.longitude, p_accuracy_m: p.accuracyM, p_org: p.orgId,
    } as never);
    return classify(error);
  } catch {
    return classify({ message: 'network' });
  }
}

/**
 * A punch with its selfie, to the app server (/api/mobile/punch): files only ever reach storage through the server,
 * which records the punch as this person. A refusal for good is kept with its reason; anything else waits for the
 * next sync.
 */
async function sendWithPhoto(p: QueuedPunch, photoUri: string) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return classifyHttp(401, null);
    const form = new FormData();
    form.append('clientId', p.clientId);
    form.append('orgId', p.orgId);
    form.append('punchedAt', p.punchedAt);
    if (p.latitude !== null) form.append('latitude', String(p.latitude));
    if (p.longitude !== null) form.append('longitude', String(p.longitude));
    if (p.accuracyM !== null) form.append('accuracy', String(p.accuracyM));
    if (Platform.OS === 'web') form.append('selfie', await (await fetch(photoUri)).blob(), 'selfie.jpg');
    else form.append('selfie', { uri: photoUri, name: 'selfie.jpg', type: 'image/jpeg' } as unknown as Blob);
    const res = await fetch(`${SITE_URL}/api/mobile/punch`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } });
    return classifyHttp(res.status, (await res.json().catch(() => null)) as { ok?: boolean; message?: string; permanent?: boolean } | null);
  } catch {
    return classifyHttp(0, null);
  }
}

/**
 * Where the person is, for the geofence. Refuses mock locations (Android reports them; threat model T10) and
 * very rough fixes; the server checks the fence.
 */
export async function currentPosition(): Promise<{ latitude: number; longitude: number; accuracyM: number } | { error: string }> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return { error: 'Allow location access to check in. Your office uses it to confirm you were on site.' };
  if (!(await within(Location.hasServicesEnabledAsync(), 3000, true))) return { error: 'Turn on Location in your phone’s settings to check in.' };
  // A precise fix can take a long time indoors (or never come): wait a while, then use one from the last two minutes.
  const pos = await within(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 15_000, null)
    ?? await within(Location.getLastKnownPositionAsync({ maxAge: 120_000 }), 3000, null);
  if (!pos) return { error: 'Couldn’t find your location. Move closer to a window or step outside, then try again.' };
  if (pos.mocked) return { error: 'A mock location app is on. Turn it off to check in.' };
  const accuracy = Math.round(pos.coords.accuracy ?? 9999);
  if (accuracy > 500) return { error: 'Your location is too rough right now. Move closer to a window and try again.' };
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: accuracy };
}

export const newClientId = () => `mobile-${Crypto.randomUUID()}`;
