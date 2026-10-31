import {
  getServerReviewRefreshGeneration,
  requestServerReviewRefresh,
  resetServerReviewRefreshForTests,
  subscribeServerReviewRefresh,
} from '../serverReviewRefresh';

describe('serverReviewRefresh', () => {
  beforeEach(() => {
    resetServerReviewRefreshForTests();
  });

  test('request notifies subscribers and advances generation', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeServerReviewRefresh(listener);

    expect(getServerReviewRefreshGeneration()).toBe(0);
    requestServerReviewRefresh();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getServerReviewRefreshGeneration()).toBe(1);

    requestServerReviewRefresh();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getServerReviewRefreshGeneration()).toBe(2);

    unsubscribe();
    requestServerReviewRefresh();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getServerReviewRefreshGeneration()).toBe(3);
  });

  test('request is safe with no subscribers', () => {
    expect(() => requestServerReviewRefresh()).not.toThrow();
    expect(getServerReviewRefreshGeneration()).toBe(1);
  });
});
