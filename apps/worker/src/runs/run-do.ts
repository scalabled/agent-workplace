import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/**
 * RunDO — one long job (renders, builds, portrait generation): checkpoint, ≤2 attempts (ARCHITECTURE §2.2).
 * Inc 0 STUB: media may use it for portrait jobs.
 */
export class RunDO extends DurableObject<Env> {
  async ping(): Promise<'pong'> {
    return 'pong';
  }
}
