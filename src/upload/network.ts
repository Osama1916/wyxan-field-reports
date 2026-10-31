import NetInfo, {type NetInfoState} from '@react-native-community/netinfo';
import {kickUploadWorker} from './worker';

let unsubscribe: (() => void) | null = null;
let wasOffline = false;

/** Test helper: clear singleton listener state between cases. */
export function resetUploadNetworkListenerForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  wasOffline = false;
}

function isOnline(state: NetInfoState): boolean {
  if (state.isConnected === false) {
    return false;
  }
  // isInternetReachable can be null while unknown — treat as online enough to try.
  if (state.isInternetReachable === false) {
    return false;
  }
  return true;
}

/**
 * Subscribe once: when connectivity returns, kick the existing single-flight worker.
 * Does not create additional workers.
 */
export function startUploadNetworkListener(): () => void {
  if (unsubscribe) {
    return unsubscribe;
  }

  unsubscribe = NetInfo.addEventListener(state => {
    const online = isOnline(state);
    if (!online) {
      wasOffline = true;
      return;
    }
    if (wasOffline) {
      wasOffline = false;
      void kickUploadWorker();
    }
  });

  // Initial probe — if already online, still allow an early kick from App.
  void NetInfo.fetch().then(state => {
    wasOffline = !isOnline(state);
  });

  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}

export async function isNetworkOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return isOnline(state);
}
