import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { SITE_URL } from './site';
import { supabase } from './supabase';

/**
 * Downloads one payslip as a PDF from the app server (your own, released payslips only) and opens the phone's
 * "open with / share" sheet, so it can be viewed, saved or sent. Returns a message when it didn't work.
 */
export async function openPayslipPdf(orgId: string, runId: string, month: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return 'Sign in again to download your payslip.';
  const url = `${SITE_URL}/api/mobile/payslip?org=${encodeURIComponent(orgId)}&run=${encodeURIComponent(runId)}`;
  try {
    if (Platform.OS === 'web') {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return 'The payslip couldn’t be downloaded. Try again.';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(await res.blob());
      link.download = `payslip-${month}.pdf`;
      link.click();
      return null;
    }
    const target = `${FileSystem.cacheDirectory}payslip-${month}.pdf`;
    const res = await FileSystem.downloadAsync(url, target, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) return 'The payslip couldn’t be downloaded. Try again.';
    if (!(await Sharing.isAvailableAsync())) return 'This phone can’t open the payslip here. Download it from the website.';
    await Sharing.shareAsync(res.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Payslip ${month}` });
    return null;
  } catch {
    return 'No connection. Try again when you’re online.';
  }
}
