import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { classify, PunchQueue } from './punch-queue';
import { supabase } from './supabase';

/** The device's queue (AsyncStorage) and how a punch reaches the server (record_punch, method 'mobile'). */
export const queue = new PunchQueue(AsyncStorage);

export async function sendPunch(p: Parameters<Parameters<PunchQueue['sync']>[0]>[0]) {
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
 * Where the person is, for the geofence. Refuses mock locations (Android reports them; threat model T10) and
 * very rough fixes; the server checks the fence.
 */
export async function currentPosition(): Promise<{ latitude: number; longitude: number; accuracyM: number } | { error: string }> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return { error: 'Allow location access to check in. Your office uses it to confirm you were on site.' };
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  if (pos.mocked) return { error: 'A mock location app is on. Turn it off to check in.' };
  const accuracy = Math.round(pos.coords.accuracy ?? 9999);
  if (accuracy > 500) return { error: 'Your location is too rough right now. Move closer to a window and try again.' };
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: accuracy };
}

export const newClientId = () => `mobile-${Crypto.randomUUID()}`;
