/**
 * NetInfo must kick the upload worker only — never GET /reports.
 */

const mockListServerReports = jest.fn();
const mockKickUploadWorker = jest.fn(async () => undefined);

type NetInfoState = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

let mockNetInfoListener: ((state: NetInfoState) => void) | null = null;

jest.mock('../../api', () => ({
  listServerReports: () => mockListServerReports(),
}));

jest.mock('../worker', () => ({
  kickUploadWorker: () => mockKickUploadWorker(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: NetInfoState) => void) => {
      mockNetInfoListener = listener;
      return () => {
        if (mockNetInfoListener === listener) {
          mockNetInfoListener = null;
        }
      };
    },
    fetch: jest.fn(async () => ({
      isConnected: false,
      isInternetReachable: false,
    })),
  },
}));

import {
  resetUploadNetworkListenerForTests,
  startUploadNetworkListener,
} from '../network';

describe('startUploadNetworkListener', () => {
  beforeEach(() => {
    resetUploadNetworkListenerForTests();
    mockListServerReports.mockClear();
    mockKickUploadWorker.mockClear();
    mockNetInfoListener = null;
  });

  afterEach(() => {
    resetUploadNetworkListenerForTests();
  });

  test('NetInfo online/offline events do not trigger GET /reports', async () => {
    startUploadNetworkListener();

    mockNetInfoListener?.({isConnected: false, isInternetReachable: false});
    mockNetInfoListener?.({isConnected: true, isInternetReachable: true});
    mockNetInfoListener?.({isConnected: true, isInternetReachable: true});
    mockNetInfoListener?.({isConnected: false, isInternetReachable: false});
    mockNetInfoListener?.({isConnected: true, isInternetReachable: true});

    expect(mockKickUploadWorker).toHaveBeenCalled();
    expect(mockListServerReports).not.toHaveBeenCalled();
  });
});
