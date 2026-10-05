export interface CompiledRoute<T> {
  method: string;
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  config: T;
}

/**
 * Compile `"METHOD /path"` keys. Paths support `:param`, `*` (one segment) and `**` (any depth).
 * A key without a method (`"/path"`) or with `*` matches every method. First match wins.
 */
export function compileRoutes<T>(routes: Record<string, T>): CompiledRoute<T>[] {
  return Object.entries(routes).map(([key, config]) => {
    const parts = key.trim().split(/\s+/);
    const [method, pattern] = parts.length === 1 ? ['*', parts[0]!] : [parts[0]!.toUpperCase(), parts[1]!];
    const paramNames: string[] = [];
    const source = pattern
      .split('/')
      .map((segment) => {
        if (segment === '**') return '.*';
        if (segment === '*') return '[^/]+';
        if (segment.startsWith(':')) {
          paramNames.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/')
      // `/a/**` should also match `/a`.
      .replace(/\/\.\*$/, '(?:/.*)?');
    return { method, pattern, regex: new RegExp(`^${source}/?$`), paramNames, config };
  });
}

export function matchRoute<T>(
  routes: CompiledRoute<T>[],
  method: string,
  path: string,
): { route: CompiledRoute<T>; params: Record<string, string> } | undefined {
  const upper = method.toUpperCase();
  for (const route of routes) {
    if (route.method !== '*' && route.method !== upper) continue;
    const match = route.regex.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1] ?? '');
    });
    return { route, params };
  }
  return undefined;
}
