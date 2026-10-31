import {PermissionsAndroid, Platform} from 'react-native';

export type MediaPermissionResult =
  | {granted: true}
  | {granted: false; message: string};

/**
 * Camera launch uses the system camera Intent. If CAMERA is declared in the
 * AndroidManifest (it is), Android requires a runtime grant before launchCamera.
 */
export async function ensureCameraPermission(): Promise<MediaPermissionResult> {
  if (Platform.OS !== 'android') {
    return {granted: true};
  }

  try {
    const existing = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.CAMERA,
    );
    if (existing) {
      return {granted: true};
    }

    const status = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Camera permission',
        message: 'Field Reports needs the camera to attach photos to a report.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      },
    );

    if (status === PermissionsAndroid.RESULTS.GRANTED) {
      return {granted: true};
    }

    return {
      granted: false,
      message:
        'Camera permission was denied. Enable it in system settings to take photos.',
    };
  } catch (error) {
    return {
      granted: false,
      message:
        error instanceof Error
          ? error.message
          : 'Could not request camera permission.',
    };
  }
}

/**
 * Modern Android Photo Picker does not require storage permission.
 * On API ≤ 32, request READ_EXTERNAL_STORAGE when still needed by the picker.
 */
export async function ensureGalleryPermission(): Promise<MediaPermissionResult> {
  if (Platform.OS !== 'android') {
    return {granted: true};
  }

  const apiLevel =
    typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);

  if (!Number.isFinite(apiLevel) || apiLevel >= 33) {
    return {granted: true};
  }

  try {
    const permission = PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
    const existing = await PermissionsAndroid.check(permission);
    if (existing) {
      return {granted: true};
    }

    const status = await PermissionsAndroid.request(permission, {
      title: 'Photo library permission',
      message: 'Field Reports needs access to your photos to attach them to a report.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    });

    if (status === PermissionsAndroid.RESULTS.GRANTED) {
      return {granted: true};
    }

    return {
      granted: false,
      message:
        'Photo library permission was denied. Enable it in system settings to choose photos.',
    };
  } catch (error) {
    return {
      granted: false,
      message:
        error instanceof Error
          ? error.message
          : 'Could not request photo library permission.',
    };
  }
}
