// Data client — a small query-builder-style client (.from/.storage/.auth/
// .functions/.rpc/.channel) that routes every call through the Laravel REST
// API at /api/v1/db/*. See ./laravel-bridge.ts for the implementation.
import { laravelDataBridge } from './laravel-bridge';

// eslint-disable-next-line no-console
console.info("[data-client] Routing to Laravel API at /api/v1/db/*");

// Typed loosely on purpose: call sites pass arbitrary table names and rely
// on the bridge's dynamic row shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dataClient = laravelDataBridge as any;

/** Kept for existing call sites; the app always talks to Laravel. */
export const IS_LARAVEL_ONLY = true;
