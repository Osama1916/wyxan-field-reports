type OpenArgs = {name: string; location?: string};

const mockOpen = jest.fn((_options: OpenArgs) => ({
  execute: jest.fn(async () => ({rows: [], rowsAffected: 0})),
  transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
    await fn({
      execute: jest.fn(async () => ({rows: [], rowsAffected: 0})),
    });
  }),
  close: jest.fn(),
}));

jest.mock('@op-engineering/op-sqlite', () => ({
  open: (options: OpenArgs) => mockOpen(options),
}));

import {openOpSqliteDatabase} from '../adapters';

describe('openOpSqliteDatabase', () => {
  beforeEach(() => {
    mockOpen.mockClear();
  });

  test('omits location when unset so JSI does not see undefined', () => {
    openOpSqliteDatabase({name: 'fieldreports.sqlite'});

    expect(mockOpen).toHaveBeenCalledTimes(1);
    const passed = mockOpen.mock.calls[0]?.[0];
    expect(passed).toEqual({name: 'fieldreports.sqlite'});
    expect(Object.prototype.hasOwnProperty.call(passed, 'location')).toBe(
      false,
    );
  });

  test('passes location only when provided', () => {
    openOpSqliteDatabase({
      name: 'fieldreports.sqlite',
      location: '/data/data/com.fieldreports/databases',
    });

    expect(mockOpen).toHaveBeenCalledWith({
      name: 'fieldreports.sqlite',
      location: '/data/data/com.fieldreports/databases',
    });
  });
});
