/**
 * Lightweight HTTP router with path parameter support.
 */

export interface RouteHandler {
  (req: Request, params: Record<string, string>): Response | Promise<Response>;
}

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  addRoute(method: string, path: string, handler: RouteHandler): this {
    const paramNames: string[] = [];
    const pattern = new RegExp(
      "^" + path.replace(/:(\w+)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      }) + "$"
    );
    this.routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
    return this;
  }

  get(path: string, handler: RouteHandler): this {
    return this.addRoute("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): this {
    return this.addRoute("POST", path, handler);
  }

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const params = Object.fromEntries(
        route.paramNames.map((name, i) => [name, match[i + 1]])
      );
      return route.handler(req, params);
    }
    return new Response("Not Found", { status: 404 });
  }

  private matchRoute(path: string): Route | null {
    return this.routes.find(r => r.pattern.test(path)) ?? null;
  }
}

export function createRouter(): Router {
  return new Router();
}
