/**
 * SavedReportsScreen must not spam GET /reports on re-render, upload events, or NetInfo.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

const mockListServerReports = jest.fn(async (): Promise<{reports: never[]}> => ({
  reports: [],
}));
const mockGetServerReport = jest.fn(async (id: string) => ({
  id,
  idempotencyKey: `key-${id}`,
  description: 'detail',
  createdAt: '2026-01-01T00:00:00.000Z',
  images: [],
}));
const mockListReports = jest.fn(async (_db: unknown): Promise<unknown[]> => []);
const mockGetReportWithDetails = jest.fn(
  async (_db: unknown, _id: unknown): Promise<null> => null,
);
const mockGetDatabase = jest.fn(() => ({}));
const mockKickUploadWorker = jest.fn(async (): Promise<void> => undefined);
const mockRetryFailedReport = jest.fn(
  async (_db: unknown, _reportId: unknown): Promise<boolean> => false,
);

type WorkerListener = (event: {
  type: 'pass_started' | 'job_result' | 'pass_finished' | 'error';
  result?: unknown;
  processed?: number;
  message?: string;
}) => void;

let mockWorkerListener: WorkerListener | null = null;
const mockServerReviewListeners = new Set<() => void>();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  exists: jest.fn(async () => true),
}));

jest.mock('../../api', () => ({
  getApiBaseUrl: () => 'http://10.0.2.2:3000',
  listServerReports: () => mockListServerReports(),
  getServerReport: (id: string) => mockGetServerReport(id),
  resolveServerImageUrl: (url: string | null | undefined) => {
    if (url == null || String(url).trim() === '') {
      return null;
    }
    const trimmed = String(url).trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `http://10.0.2.2:3000${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  },
  subscribeServerReviewRefresh: (listener: () => void) => {
    mockServerReviewListeners.add(listener);
    return () => {
      mockServerReviewListeners.delete(listener);
    };
  },
}));

jest.mock('../../db', () => ({
  formatDatabaseErrorForDisplay: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  getDatabase: () => mockGetDatabase(),
  listReports: (db: unknown) => mockListReports(db),
  getReportWithDetails: (db: unknown, id: unknown) =>
    mockGetReportWithDetails(db, id),
}));

jest.mock('../../upload', () => ({
  kickUploadWorker: () => mockKickUploadWorker(),
  retryFailedReport: (db: unknown, reportId: unknown) =>
    mockRetryFailedReport(db, reportId),
  subscribeUploadWorker: (listener: WorkerListener) => {
    mockWorkerListener = listener;
    return () => {
      if (mockWorkerListener === listener) {
        mockWorkerListener = null;
      }
    };
  },
}));

import {SavedReportsScreen} from '../SavedReportsScreen';

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SavedReportsScreen GET /reports behaviour', () => {
  beforeEach(() => {
    mockListServerReports.mockClear();
    mockListServerReports.mockResolvedValue({reports: []});
    mockGetServerReport.mockClear();
    mockGetServerReport.mockResolvedValue({
      id: 'x',
      idempotencyKey: 'key-x',
      description: 'detail',
      createdAt: '2026-01-01T00:00:00.000Z',
      images: [],
    });
    mockListReports.mockClear();
    mockListReports.mockResolvedValue([]);
    mockGetReportWithDetails.mockClear();
    mockGetDatabase.mockClear();
    mockKickUploadWorker.mockClear();
    mockRetryFailedReport.mockClear();
    mockWorkerListener = null;
    mockServerReviewListeners.clear();
  });

  test('opening Saved Reports triggers one GET', async () => {
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={1} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockListServerReports).toHaveBeenCalledTimes(1);
  });

  test('re-rendering does not trigger another GET', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen
          onBack={() => undefined}
          onRefreshRequest={10}
          highlightReportId={null}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockListServerReports).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      tree.update(
        <SavedReportsScreen
          onBack={() => undefined}
          onRefreshRequest={10}
          highlightReportId={null}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockListServerReports).toHaveBeenCalledTimes(1);
  });

  test('non-success upload worker events do not trigger GET /reports', async () => {
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={20} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockListServerReports).toHaveBeenCalledTimes(1);
    expect(mockWorkerListener).toBeTruthy();

    mockListReports.mockClear();
    await ReactTestRenderer.act(async () => {
      mockWorkerListener?.({
        type: 'job_result',
        result: {outcome: 'failed', reportId: 1, attemptCount: 1, error: 'x'},
      });
      mockWorkerListener?.({type: 'pass_finished', processed: 1});
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockListServerReports).toHaveBeenCalledTimes(1);
    expect(mockListReports).toHaveBeenCalled();
  });

  test('server-review refresh signal triggers an additional GET /reports', async () => {
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={21} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockListServerReports).toHaveBeenCalledTimes(1);
    expect(mockServerReviewListeners.size).toBe(1);

    await ReactTestRenderer.act(async () => {
      for (const listener of mockServerReviewListeners) {
        listener();
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockListServerReports).toHaveBeenCalledTimes(2);
  });

  test('manual Reload triggers one additional GET', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={30} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockListServerReports).toHaveBeenCalledTimes(1);

    const reload = tree.root.findByProps({testID: 'reload-reports'});

    await ReactTestRenderer.act(async () => {
      reload.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(mockListServerReports).toHaveBeenCalledTimes(2);
  });
});
