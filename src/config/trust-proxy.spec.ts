import { isTrustProxyValue } from './trust-proxy';

describe('TRUST_PROXY values', () => {
  it.each(['', '   ', 'false', 'FALSE', '1', '2', 'loopback', 'linklocal, uniquelocal', '10.0.0.0/8', '192.168.1.5', '10.0.0.0/8, 192.168.1.5', '::1', 'fd00::/8', 'loopback, 10.1.2.3'])(
    'accepts %p',
    (value) => {
      expect(isTrustProxyValue(value)).toBe(true);
    },
  );

  it.each(['true', 'TRUE', 'yes', 'on', '0', '-1', '33', '1.5', 'everyone', '10.0.0.0/33', '10.0.0.256', '::1/129', '10.0.0.0/8/8', ',', 'loopback,,nonsense'])(
    'refuses %p (trusting everyone, or not a hop count / address list)',
    (value) => {
      expect(isTrustProxyValue(value)).toBe(false);
    },
  );
});
