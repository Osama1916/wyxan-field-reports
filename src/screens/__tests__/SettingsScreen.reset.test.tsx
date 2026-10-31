/**
 * Settings reset: Cancel must not call reset; confirm must; honest errors.
 */

import React from 'react';
import {Alert} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

const mockReset = jest.fn();
const mockGetDatabase = jest.fn(() => ({mocked: true}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('../../db', () => ({
  getDatabase: () => mockGetDatabase(),
}));

jest.mock('../../reports/resetAllReports', () => {
  class ResetAllReportsError extends Error {
    code: string;
    serverResetCompleted: boolean;
    constructor(
      code: string,
      message: string,
      options?: {serverResetCompleted?: boolean},
    ) {
      super(message);
      this.name = 'ResetAllReportsError';
      this.code = code;
      this.serverResetCompleted = options?.serverResetCompleted === true;
    }
  }
  return {
    ResetAllReportsError,
    resetAllLocalAndServerReports: (...args: unknown[]) => mockReset(...args),
  };
});

import {SettingsScreen} from '../SettingsScreen';
import {ResetAllReportsError} from '../../reports/resetAllReports';

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SettingsScreen reset', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockReset.mockReset();
    mockGetDatabase.mockClear();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test('Cancel does not reset anything', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<SettingsScreen onBack={jest.fn()} />);
    });

    const button = tree.root.findByProps({testID: 'reset-all-reports'});
    await ReactTestRenderer.act(() => {
      button.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Reset all reports?',
      expect.stringContaining('Network access is required'),
      expect.any(Array),
    );

    const buttons = alertSpy.mock.calls[0]![2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const cancel = buttons.find(b => b.text === 'Cancel');
    expect(cancel).toBeTruthy();
    // Cancel has no onPress / does nothing.
    cancel?.onPress?.();
    await flush();

    expect(mockReset).not.toHaveBeenCalled();
    expect(() => tree.root.findByProps({testID: 'reset-success-notice'})).toThrow();
  });

  test('confirmed reset shows success only after completion', async () => {
    mockReset.mockResolvedValue({
      deletedLocalReports: 2,
      deletedLocalPhotoFiles: 3,
      server: {
        message: 'ok',
        deletedReports: 4,
        deletedTrackedImageFiles: 4,
        deletedUploadFiles: 4,
        deletedTempFiles: 0,
      },
    });

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<SettingsScreen onBack={jest.fn()} />);
    });

    const button = tree.root.findByProps({testID: 'reset-all-reports'});
    await ReactTestRenderer.act(() => {
      button.props.onPress();
    });

    const buttons = alertSpy.mock.calls[0]![2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const confirm = buttons.find(b => b.text === 'Reset all reports');
    await ReactTestRenderer.act(async () => {
      confirm?.onPress?.();
      await flush();
    });

    expect(mockReset).toHaveBeenCalledTimes(1);
    const success = tree.root.findByProps({testID: 'reset-success-notice'});
    expect(success.props.accessibilityLabel).toBe('Reset success');
    expect(() => tree.root.findByProps({testID: 'reset-error-notice'})).toThrow();
  });

  test('network failure does not show success', async () => {
    mockReset.mockRejectedValue(
      new ResetAllReportsError(
        'server',
        'Server reset failed: Network request failed. Local reports were not deleted.',
      ),
    );

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<SettingsScreen onBack={jest.fn()} />);
    });

    const button = tree.root.findByProps({testID: 'reset-all-reports'});
    await ReactTestRenderer.act(() => {
      button.props.onPress();
    });
    const buttons = alertSpy.mock.calls[0]![2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    await ReactTestRenderer.act(async () => {
      buttons.find(b => b.text === 'Reset all reports')?.onPress?.();
      await flush();
    });

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(() => tree.root.findByProps({testID: 'reset-success-notice'})).toThrow();
    const error = tree.root.findByProps({testID: 'reset-error-notice'});
    const texts = error.findAllByType('Text' as never).map(node =>
      String((node.props as {children?: unknown}).children),
    );
    expect(texts.join(' ')).toContain('Server reset failed');
  });
});
