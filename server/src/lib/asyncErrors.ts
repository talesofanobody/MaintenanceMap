/**
 * Why one failed query took the whole property's system down.
 *
 * Express 4 does nothing with what a route handler returns. When the handler is
 * `async` and its promise rejects — a query against a column that is not there
 * yet, a database locked by a burst of photo uploads — nothing catches it, so it
 * becomes an unhandled rejection and Node's default is to kill the process. One
 * technician's failed request ends everybody's session, mid-walk.
 *
 * That is not a rare shape here: 86 of this app's 125 async handlers await
 * something without a try/catch. Wrapping each by hand is 86 chances to miss one,
 * and a miss is invisible until the night it matters. So this patches the one
 * place every handler passes through — Express's Layer, which calls it. If what
 * comes back is a promise, its rejection goes to `next`, which is exactly what a
 * synchronous `throw` already does. The error middleware in index.ts then answers
 * that one request with a 500 and the server carries on serving everyone else.
 *
 * Express 5 does this itself. When this app moves to it, delete this file. Until
 * then the patch refuses to guess: if Express's internals are not the shape it
 * expects, it leaves them alone and says so, rather than breaking the boot.
 */

type AnyFn = (...args: unknown[]) => unknown;

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof (value as Promise<unknown> | undefined)?.catch === "function";
}

function wrap(fn: AnyFn): AnyFn {
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const result = fn.apply(this, args);
    // (req, res, next) for a handler, (err, req, res, next) for an error handler,
    // and (req, res, next, value, name) for a route parameter — where `next` is
    // no longer last.
    const next = args.length === 5 ? args[2] : args[args.length - 1];
    if (isPromise(result) && typeof next === "function") {
      result.catch(next as (err: unknown) => void);
    }
    return result;
  };

  // Express decides what a function *is* by counting its arguments: four means an
  // error handler, and anything else is skipped when an error is in flight. The
  // wrapper takes a rest parameter, so it has to be told to report the arity of
  // the function it stands in for.
  Object.defineProperty(wrapped, "length", { value: fn.length, configurable: true });
  const source = fn as unknown as Record<string, unknown>;
  const target = wrapped as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) target[key] = source[key];
  return wrapped;
}

function install(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Layer = require("express/lib/router/layer");
    const proto = Layer?.prototype;
    // Only proceed against the Express we know: a Layer that stores its handler on
    // `handle` and dispatches through `handle_request`.
    if (!proto || typeof proto.handle_request !== "function" || typeof proto.handle_error !== "function") {
      return false;
    }
    Object.defineProperty(proto, "handle", {
      enumerable: true,
      configurable: true,
      get(this: { __handle?: AnyFn }) {
        return this.__handle;
      },
      set(this: { __handle?: AnyFn }, fn: AnyFn) {
        this.__handle = typeof fn === "function" ? wrap(fn) : fn;
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the patch took. Imported for its side effect, so this runs before any
 * route file is loaded — a Layer built before the patch would keep the raw
 * handler.
 */
export const asyncRouteErrorsCaught = install();

/**
 * The backstop, for rejections that belong to no request: a background job, a
 * timer, something that escaped. Logging and staying up is right here — the
 * request it came from gets no answer, but the other forty people on shift keep
 * theirs.
 *
 * `uncaughtException` is deliberately left to Node, which crashes. A rejected
 * query leaves the process healthy; a genuinely uncaught throw may not, and a
 * container that restarts is easier to trust than one limping on in a state
 * nobody has reasoned about.
 */
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection — the server is staying up:", reason);
});
