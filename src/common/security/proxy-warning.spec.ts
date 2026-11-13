import type { Request, Response } from 'express';
import { createProxyHeaderWarning } from './proxy-warning';

const request = (headers: Record<string, string>) => ({ headers }) as unknown as Request;
const run = (middleware: ReturnType<typeof createProxyHeaderWarning>, headers: Record<string, string>) => {
  const next = jest.fn();
  middleware(request(headers), {} as Response, next);
  return next;
};

describe('reverse-proxy warning', () => {
  it('warns once when forwarded-address headers arrive while TRUST_PROXY is unset, and never blocks the request', () => {
    const warn = jest.fn();
    const middleware = createProxyHeaderWarning({}, warn);

    expect(run(middleware, { 'x-forwarded-for': '203.0.113.9' })).toHaveBeenCalledTimes(1);
    run(middleware, { 'x-forwarded-for': '203.0.113.10' });
    run(middleware, { 'x-real-ip': '203.0.113.11' });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('TRUST_PROXY');
  });

  it.each([['x-forwarded-for'], ['x-real-ip'], ['forwarded']])('recognises the %s header', (header) => {
    const warn = jest.fn();
    run(createProxyHeaderWarning({}, warn), { [header]: '203.0.113.9' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for direct clients and when TRUST_PROXY is configured', () => {
    const warn = jest.fn();
    run(createProxyHeaderWarning({}, warn), { host: 'api.customer.example' });
    run(createProxyHeaderWarning({ TRUST_PROXY: '1' }, warn), { 'x-forwarded-for': '203.0.113.9' });
    run(createProxyHeaderWarning({ TRUST_PROXY: 'loopback' }, warn), { 'x-forwarded-for': '203.0.113.9' });

    expect(warn).not.toHaveBeenCalled();
  });
});
