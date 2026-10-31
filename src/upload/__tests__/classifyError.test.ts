import {ApiError} from '../../api/errors';
import {classifyUploadError} from '../classifyError';

describe('classifyUploadError', () => {
  test('marks permanent 4xx as non-retryable', () => {
    const result = classifyUploadError(
      new ApiError('description is required', {
        kind: 'http',
        status: 400,
        retryable: false,
      }),
    );
    expect(result.retryable).toBe(false);
  });

  test('marks timeout and 5xx as retryable', () => {
    expect(
      classifyUploadError(
        new ApiError('Request timed out', {
          kind: 'timeout',
          retryable: true,
        }),
      ).retryable,
    ).toBe(true);

    expect(
      classifyUploadError(
        new ApiError('server boom', {
          kind: 'http',
          status: 500,
          retryable: true,
        }),
      ).retryable,
    ).toBe(true);
  });
});
