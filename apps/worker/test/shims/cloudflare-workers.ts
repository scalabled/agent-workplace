// Node-side stand-in for the `cloudflare:workers` module so Durable Object classes can be unit-tested
// in-process (aliased in vitest.config.ts). The real runtime is exercised by `pnpm dev` / e2e.
export class DurableObject<Env = unknown> {
  protected ctx: DurableObjectState;
  protected env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint<Env = unknown> {
  protected ctx: ExecutionContext;
  protected env: Env;
  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class RpcTarget {}
