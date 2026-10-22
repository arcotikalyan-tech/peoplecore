import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * A selfie for check-in: the front camera, then made small (720 px wide, JPEG) so it sends quickly and stays under
 * the server's 2 MB limit. Null when the person cancels; an error message when the camera isn't allowed.
 */
export async function takeSelfie(): Promise<{ uri: string } | { error: string } | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { error: 'Allow camera access to check in. Your company asks for a selfie with each check-in and check-out.' };
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], cameraType: ImagePicker.CameraType.front, quality: 0.8, allowsEditing: false });
  if (shot.canceled || !shot.assets[0]) return null;
  const small = await ImageManipulator.manipulateAsync(shot.assets[0].uri, [{ resize: { width: 720 } }], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: small.uri };
}
