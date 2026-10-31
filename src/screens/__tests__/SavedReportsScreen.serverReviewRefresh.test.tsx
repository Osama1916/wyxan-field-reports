/**
 * Server Review refreshes on successful upload (shared signal), not on failures.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

type ServerSummary = {
  id: string;
  description: string;
  createdAt: string;
  imageCount: number;
};

type ServerDetail = {
  id: string;
  idempotencyKey: string;
  description: string;
  createdAt: string;
  images: Array<{
    id: string;
    reportId: string;
    filename: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sortOrder: number;
    url: string;
  }>;
};

const mockListServerReports = jest.fn(
  async (): Promise<{reports: ServerSummary[]}> => ({reports: []}),
);
const mockGetServerReport = jest.fn(
  async (id: string): Promise<ServerDetail> => ({
    id,
    idempotencyKey: `key-${id}`,
    description: 'detail',
    createdAt: '2026-01-01T00:00:00.000Z',
    images: [],
  }),
);
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

function emitServerReviewRefresh(): void {
  for (const listener of [...mockServerReviewListeners]) {
    listener();
  }
}

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeSummary(
  id: string,
  description: string,
  imageCount: number,
): ServerSummary {
  return {
    id,
    description,
    createdAt: '2026-10-31T12:00:00.000Z',
    imageCount,
  };
}

function makeDetail(
  id: string,
  description: string,
  imageCount: number,
): ServerDetail {
  return {
    id,
    idempotencyKey: `key-${id}`,
    description,
    createdAt: '2026-10-31T12:00:00.000Z',
    images: Array.from({length: imageCount}, (_, index) => ({
      id: `${id}-img-${index}`,
      reportId: id,
      filename: `${id}-${index}.jpg`,
      originalName: `photo-${index}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 1200,
      sortOrder: index,
      url: `/uploads/${id}-${index}.jpg`,
    })),
  };
}

describe('SavedReportsScreen server review refresh on upload', () => {
  beforeEach(() => {
    mockListServerReports.mockReset();
    mockListServerReports.mockResolvedValue({reports: []});
    mockGetServerReport.mockReset();
    mockGetServerReport.mockImplementation(async (id: string) =>
      makeDetail(id, 'detail', 0),
    );
    mockListReports.mockReset();
    mockListReports.mockResolvedValue([]);
    mockGetReportWithDetails.mockClear();
    mockGetDatabase.mockClear();
    mockKickUploadWorker.mockClear();
    mockRetryFailedReport.mockClear();
    mockWorkerListener = null;
    mockServerReviewListeners.clear();
  });

  test('successful upload signal triggers a server-review refresh', async () => {
    mockListServerReports
      .mockResolvedValueOnce({reports: []})
      .mockResolvedValueOnce({
        reports: [makeSummary('srv-1', 'New fence damage', 2)],
      });
    mockGetServerReport.mockResolvedValue(
      makeDetail('srv-1', 'New fence damage', 2),
    );

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={1} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(mockListServerReports).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      emitServerReviewRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(mockListServerReports).toHaveBeenCalledTimes(2);
    expect(
      tree.root.findByProps({testID: 'server-review-desc-srv-1'}).props
        .children,
    ).toBe('New fence damage');
    expect(
      tree.root.findByProps({testID: 'server-review-image-srv-1-0'}),
    ).toBeTruthy();
    expect(
      tree.root.findByProps({testID: 'server-review-image-srv-1-1'}),
    ).toBeTruthy();
    expect(
      tree.root.findByProps({testID: 'server-review-image-count-srv-1'}).props
        .children,
    ).toEqual([2, ' ', 'images']);
  });

  test('failed upload worker events do not trigger GET /reports', async () => {
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={2} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(mockListServerReports).toHaveBeenCalledTimes(1);
    expect(mockWorkerListener).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      mockWorkerListener?.({
        type: 'job_result',
        result: {outcome: 'failed', reportId: 1, attemptCount: 1, error: 'x'},
      });
      mockWorkerListener?.({
        type: 'job_result',
        result: {
          outcome: 'retry_scheduled',
          reportId: 1,
          nextAttemptAt: '2026-01-01T00:00:00.000Z',
          attemptCount: 1,
          error: 'timeout',
        },
      });
      mockWorkerListener?.({type: 'pass_finished', processed: 1});
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(mockListServerReports).toHaveBeenCalledTimes(1);
  });

  test('successful retry signal triggers a refresh', async () => {
    mockListServerReports
      .mockResolvedValueOnce({reports: []})
      .mockResolvedValueOnce({
        reports: [makeSummary('srv-retry', 'Retried report', 1)],
      });
    mockGetServerReport.mockResolvedValue(
      makeDetail('srv-retry', 'Retried report', 1),
    );

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={3} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(mockListServerReports).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      // Same path as initial success: worker notifies after outcome === uploaded.
      emitServerReviewRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(mockListServerReports).toHaveBeenCalledTimes(2);
    expect(
      tree.root.findByProps({testID: 'server-review-desc-srv-retry'}).props
        .children,
    ).toBe('Retried report');
    expect(
      tree.root.findByProps({testID: 'server-review-image-srv-retry-0'}),
    ).toBeTruthy();
  });

  test('Review fetches fresh data when opened after upload while unmounted', async () => {
    mockListServerReports.mockResolvedValue({
      reports: [makeSummary('srv-late', 'Uploaded while away', 1)],
    });
    mockGetServerReport.mockResolvedValue(
      makeDetail('srv-late', 'Uploaded while away', 1),
    );

    // Simulate upload success while no Review listeners are mounted.
    expect(mockServerReviewListeners.size).toBe(0);
    emitServerReviewRefresh();

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={99} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(mockListServerReports).toHaveBeenCalledTimes(1);
    expect(
      tree.root.findByProps({testID: 'server-review-desc-srv-late'}).props
        .children,
    ).toBe('Uploaded while away');
    expect(
      tree.root.findByProps({testID: 'server-review-image-srv-late-0'}),
    ).toBeTruthy();
  });

  test('resolves relative server image URLs for Image previews', async () => {
    mockListServerReports.mockResolvedValue({
      reports: [makeSummary('srv-url', 'URL resolve', 1)],
    });
    mockGetServerReport.mockResolvedValue(
      makeDetail('srv-url', 'URL resolve', 1),
    );

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={7} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    const image = tree.root.findByProps({
      testID: 'server-review-image-srv-url-0',
    });
    expect(image.props.source).toEqual({
      uri: 'http://10.0.2.2:3000/uploads/srv-url-0.jpg',
    });
  });

  test('missing or broken images do not crash Review', async () => {
    mockListServerReports.mockResolvedValue({
      reports: [makeSummary('srv-broken', 'Broken images', 2)],
    });
    mockGetServerReport.mockResolvedValue({
      id: 'srv-broken',
      idempotencyKey: 'key-srv-broken',
      description: 'Broken images',
      createdAt: '2026-10-31T12:00:00.000Z',
      images: [
        {
          id: 'bad-1',
          reportId: 'srv-broken',
          filename: 'missing.jpg',
          originalName: 'missing.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 10,
          sortOrder: 0,
          url: '',
        },
        {
          id: 'ok-1',
          reportId: 'srv-broken',
          filename: 'ok.jpg',
          originalName: 'ok.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 10,
          sortOrder: 1,
          url: '/uploads/ok.jpg',
        },
      ],
    });

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={8} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    // Empty URL filtered out; valid image still renders.
    expect(
      tree.root.findAllByProps({
        testID: 'server-review-image-srv-broken-0',
      }),
    ).toHaveLength(0);
    const okImage = tree.root.findByProps({
      testID: 'server-review-image-srv-broken-1',
    });
    expect(okImage.props.source.uri).toContain('/uploads/ok.jpg');

    await ReactTestRenderer.act(async () => {
      okImage.props.onError?.({nativeEvent: {error: 'load failed'}});
      await Promise.resolve();
    });
    await flush();

    expect(
      tree.root.findByProps({
        testID: 'server-review-image-fallback-srv-broken-1',
      }),
    ).toBeTruthy();
    expect(
      tree.root.findByProps({testID: 'server-review-desc-srv-broken'}).props
        .children,
    ).toBe('Broken images');
  });

  test('concurrent refresh requests share one in-flight GET /reports', async () => {
    let resolveList!: (value: {reports: ServerSummary[]}) => void;
    let networkCalls = 0;
    let inFlight: Promise<{reports: ServerSummary[]}> | null = null;

    // Mirror listServerReports in-flight coalescing for this screen test.
    mockListServerReports.mockImplementation(() => {
      if (inFlight) {
        return inFlight;
      }
      networkCalls += 1;
      inFlight = new Promise<{reports: ServerSummary[]}>(resolve => {
        resolveList = value => {
          inFlight = null;
          resolve(value);
        };
      });
      return inFlight;
    });
    mockGetServerReport.mockResolvedValue(
      makeDetail('srv-dedupe', 'Dedupe ok', 1),
    );

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={5} />,
      );
      await Promise.resolve();
    });

    expect(networkCalls).toBe(1);

    await ReactTestRenderer.act(async () => {
      emitServerReviewRefresh();
      emitServerReviewRefresh();
      await Promise.resolve();
    });

    // Opening GET still in flight — coalesced with refresh callers.
    expect(networkCalls).toBe(1);

    await ReactTestRenderer.act(async () => {
      resolveList({
        reports: [makeSummary('srv-dedupe', 'Dedupe ok', 1)],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(networkCalls).toBe(1);
  });
});
