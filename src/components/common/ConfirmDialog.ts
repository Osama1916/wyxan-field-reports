/**
 * Native confirmation dialog helper (Alert-backed).
 * Keeps destructive confirmations consistent across screens.
 */

import {Alert} from 'react-native';

export type ConfirmDialogAction = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

export type ConfirmDialogOptions = {
  title: string;
  message: string;
  cancelText?: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

export function showConfirmDialog(options: ConfirmDialogOptions): void {
  const {
    title,
    message,
    cancelText = 'Cancel',
    confirmText,
    destructive = false,
    onConfirm,
    onCancel,
  } = options;

  const buttons: ConfirmDialogAction[] = [
    {
      text: cancelText,
      style: 'cancel',
      onPress: onCancel,
    },
    {
      text: confirmText,
      style: destructive ? 'destructive' : 'default',
      onPress: onConfirm,
    },
  ];

  Alert.alert(title, message, buttons);
}
