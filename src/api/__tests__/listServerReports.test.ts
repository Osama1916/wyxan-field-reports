/**
 * GET /reports in-flight deduplication.
 */

const fetchMock = jest.fn();
(global as unknown as {fetch: typeof fetch}).fetch = fetchMock as unknown as typeof fetch;

jest.mock('@dr.pogodin/react-native-fs', () => ({
  exists: jest.fn(async () => true),
  copyFile: jest.fn(),
  mkdir: jest.fn(),
  unlink: jest.fn(),
  DocumentDirectoryPath: '/tmp',
}));

jest.mock('../config', () => ({
  getApiBaseUrl: () => 'http://10.0.2.2:3000',
  HEALTH_REQUEST_TIMEOUT_MS: 8_000,
  UPLOAD_REQUEST_TIMEOUT_MS: 60_000,
}));

import {
  listServerReports,
  resetListServerReportsForTests,
} from '../client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('listServerReports', () => {
  beforeEach(() => {
    resetListServerReportsForTests();
    fetchMock.mockReset();
  });

  test('two simultaneous callers share one in-flight GET', async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValueOnce(gate.promise);

    const p1 = listServerReports();
    const p2 = listServerReports();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://10.0.2.2:3000/reports');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({method: 'GET'});

    gate.resolve(
      jsonResponse({
        reports: [
          {
            id: 'r1',
            description: 'One',
            createdAt: '2026-01-01T00:00:00.000Z',
            imageCount: 1,
          },
        ],
      }),
    );

    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    expect(a.reports).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a later call after settle makes exactly one new GET', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          reports: [
            {
              id: 'r1',
              description: 'First',
              createdAt: '2026-01-01T00:00:00.000Z',
              imageCount: 0,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          reports: [
            {
              id: 'r2',
              description: 'Second',
              createdAt: '2026-01-02T00:00:00.000Z',
              imageCount: 2,
            },
          ],
        }),
      );

    const first = await listServerReports();
    expect(first.reports[0]?.id).toBe('r1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await listServerReports();
    expect(second.reports[0]?.id).toBe('r2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('three concurrent refresh callers still produce one network GET', async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValueOnce(gate.promise);

    const callers = [
      listServerReports(),
      listServerReports(),
      listServerReports(),
    ];
    expect(fetchMock).toHaveBeenCalledTimes(1);

    gate.resolve(
      jsonResponse({
        reports: [
          {
            id: 'shared',
            description: 'Shared',
            createdAt: '2026-01-01T00:00:00.000Z',
            imageCount: 3,
          },
        ],
      }),
    );

    const results = await Promise.all(callers);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    expect(results[0].reports[0]?.imageCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
