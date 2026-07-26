import { log } from "./log";
import { startupContext } from "./startup";

/**
 * The production port. Lives here rather than in serve.ts so the startup line
 * and the bound port can never disagree.
 */
export const serverPort = Number(process.env.PORT ?? 3072);

/**
 * **This module logs as a side effect of being imported, and that is the point.**
 *
 * The most likely deployment failure is a missing or wrong `DATABASE_URL` or
 * `BETTER_AUTH_URL`, and the boot is deliberately aborted for either
 * (config/environment.ts, called from serve.ts before the port is bound; the db
 * client itself is lazy, so a missing URL otherwise surfaces at the first
 * query). Static imports are evaluated in declaration order, so serve.ts
 * importing this module above `./app` is what guarantees the "here is my port
 * and here is which config resolved" line is printed even when the process is
 * about to abort on a missing variable. Keep it first.
 *
 * "starting", not "listening": Bun binds the port after serve.ts finishes
 * evaluating, so at this point the claim would not yet be true.
 */
log("info", "startup.starting", startupContext(process.env, serverPort));
