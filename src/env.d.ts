/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type D1Database = import('@cloudflare/workers-types/2023-07-01').D1Database;
type ScheduledEvent = import('@cloudflare/workers-types/2023-07-01').ScheduledEvent;
type ExecutionContext = import('@cloudflare/workers-types/2023-07-01').ExecutionContext;

interface Env {
    DB: D1Database;
    ADMIN_PASSWORD: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
    interface Locals extends Runtime { }
}
