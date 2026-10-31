import {resolveServerImageUrl} from '../mediaUrl';

describe('resolveServerImageUrl', () => {
  const base = 'http://10.0.2.2:3000';

  test('joins relative /uploads paths with the configured API base URL', () => {
    expect(resolveServerImageUrl('/uploads/a.jpg', base)).toBe(
      'http://10.0.2.2:3000/uploads/a.jpg',
    );
  });

  test('joins relative paths without a leading slash', () => {
    expect(resolveServerImageUrl('uploads/b.png', base)).toBe(
      'http://10.0.2.2:3000/uploads/b.png',
    );
  });

  test('passes through absolute http(s) URLs unchanged', () => {
    expect(
      resolveServerImageUrl('https://cdn.example.com/x.jpg', base),
    ).toBe('https://cdn.example.com/x.jpg');
    expect(resolveServerImageUrl('http://localhost:3000/uploads/y.jpg', base)).toBe(
      'http://localhost:3000/uploads/y.jpg',
    );
  });

  test('strips a trailing slash from the base URL', () => {
    expect(resolveServerImageUrl('/uploads/z.jpg', 'http://10.0.2.2:3000/')).toBe(
      'http://10.0.2.2:3000/uploads/z.jpg',
    );
  });

  test('returns null for missing or blank URLs', () => {
    expect(resolveServerImageUrl(null, base)).toBeNull();
    expect(resolveServerImageUrl(undefined, base)).toBeNull();
    expect(resolveServerImageUrl('', base)).toBeNull();
    expect(resolveServerImageUrl('   ', base)).toBeNull();
  });
});
