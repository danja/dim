/**
 * Minimal path router for node:http. Routes are matched in registration
 * order; a string pattern matches the whole path exactly, a RegExp is
 * tested against it and its match is handed to the handler.
 *
 * Handlers receive { request, response, url, params, match, started }.
 */

export class RouterError extends Error {
  constructor (message) {
    super(message)
    this.name = 'RouterError'
  }
}

export class Router {
  constructor () {
    this.routes = []
  }

  /** Register a handler. methods: array of HTTP methods, e.g. ['GET']. */
  add (methods, pattern, handler) {
    if (!Array.isArray(methods) || methods.length === 0) {
      throw new RouterError('A route needs at least one method')
    }
    if (typeof pattern !== 'string' && !(pattern instanceof RegExp)) {
      throw new RouterError(`A route pattern is a string or RegExp, got ${typeof pattern}`)
    }
    if (typeof handler !== 'function') throw new RouterError('A route needs a handler function')
    this.routes.push({ methods: new Set(methods), pattern, handler })
    return this
  }

  get (pattern, handler) {
    return this.add(['GET', 'HEAD'], pattern, handler)
  }

  /**
   * Find the route for a method and path.
   * → { handler, match } | { methodNotAllowed: true } | null
   */
  match (method, path) {
    let pathMatched = false
    for (const route of this.routes) {
      const match = typeof route.pattern === 'string'
        ? (route.pattern === path ? [path] : null)
        : path.match(route.pattern)
      if (!match) continue
      pathMatched = true
      if (route.methods.has(method)) return { handler: route.handler, match }
    }
    return pathMatched ? { methodNotAllowed: true } : null
  }
}

export default Router
