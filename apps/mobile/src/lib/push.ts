import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Push notifications on this phone (Firebase Cloud Messaging; the server sends one for each in-app notification).
 * The phone's choice is remembered: on unless the person switched it off. The first sign-in asks Android for
 * permission; later ones register quietly, so a new token, or a different person signing in, is picked up.
 */
const CHOICE = 'push.choice'; // 'on' | 'off'
const TOKEN = 'push.token';   // what this phone registered, so sign-out can remove it

export type PushState = 'on' | 'off' | 'blocked' | 'unavailable';

/** Android only for now; the web build has no push. */
export const pushSupported = Platform.OS === 'android';
/** Built with the Firebase settings (app.config.js); without them nothing is asked, and Account says it isn't available. */
const configured = pushSupported && !!Constants.expoConfig?.android?.googleServicesFile;

if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function register(token?: string): Promise<PushState> {
  try {
    await Notifications.setNotificationChannelAsync('default', { name: 'PeopleCore', importance: Notifications.AndroidImportance.HIGH });
    const value = token ?? String((await Notifications.getDevicePushTokenAsync()).data);
    const { error } = await supabase.rpc('register_push_device', { p_token: value, p_platform: 'android' });
    if (error) return 'unavailable';
    await AsyncStorage.setItem(TOKEN, value);
    return 'on';
  } catch {
    return 'unavailable'; // this build has no Firebase setup, or Google Play services are missing
  }
}

/** Switches notifications on: asks Android for permission when it can, then registers this phone. */
export async function turnOnPush(): Promise<PushState> {
  if (!configured) return 'unavailable';
  await AsyncStorage.setItem(CHOICE, 'on');
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  return granted ? register() : 'blocked';
}

/** Switches notifications off on this phone (the in-app Inbox still lists everything). */
export async function turnOffPush(): Promise<void> {
  await AsyncStorage.setItem(CHOICE, 'off');
  await forgetPhone();
}

/** At sign-out: this phone stops getting the person's notifications (the choice stays for the next sign-in). */
export async function forgetPhone(): Promise<void> {
  if (!pushSupported) return;
  const token = await AsyncStorage.getItem(TOKEN);
  if (token) await supabase.rpc('unregister_push_device', { p_token: token });
  await AsyncStorage.removeItem(TOKEN);
}

/** After sign-in (and each app start): asks the first time, then keeps this phone registered while the choice is on. */
export async function syncPush(token?: string): Promise<PushState> {
  if (!configured) return 'unavailable';
  const choice = await AsyncStorage.getItem(CHOICE);
  if (choice === 'off') return 'off';
  if (choice === null) return turnOnPush();
  return (await Notifications.getPermissionsAsync()).granted ? register(token) : 'blocked';
}

/** For Account settings: on, switched off, blocked in Android's settings, or not possible here. */
export async function pushState(): Promise<PushState> {
  if (!configured) return 'unavailable';
  if ((await AsyncStorage.getItem(CHOICE)) !== 'on') return 'off';
  if (!(await Notifications.getPermissionsAsync()).granted) return 'blocked';
  return (await AsyncStorage.getItem(TOKEN)) ? 'on' : 'unavailable';
}

/** Android's settings for this app, where blocked notifications are allowed again. */
export const openPhoneSettings = () => void Linking.openSettings();
