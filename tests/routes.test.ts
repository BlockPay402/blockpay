import { compileRoutes, matchRoute } from '@blockpay402/server';
import { describe, expect, it } from 'vitest';

describe('route matching', () => {
  const routes = compileRoutes({
    'GET /weather': 1,
    'POST /datasets/:id': 2,
    'GET /premium/*': 3,
    '/files/**': 4,
  });

  it('matches method and exact path', () => {
    expect(matchRoute(routes, 'GET', '/weather')?.route.config).toBe(1);
    expect(matchRoute(routes, 'get', '/weather/')?.route.config).toBe(1);
    expect(matchRoute(routes, 'POST', '/weather')).toBeUndefined();
  });

  it('captures params', () => {
    expect(matchRoute(routes, 'POST', '/datasets/abc%20d')?.params).toEqual({ id: 'abc d' });
  });

  it('supports single and multi-segment globs', () => {
    expect(matchRoute(routes, 'GET', '/premium/a')?.route.config).toBe(3);
    expect(matchRoute(routes, 'GET', '/premium/a/b')).toBeUndefined();
    expect(matchRoute(routes, 'DELETE', '/files')?.route.config).toBe(4);
    expect(matchRoute(routes, 'PUT', '/files/a/b/c')?.route.config).toBe(4);
  });
});
