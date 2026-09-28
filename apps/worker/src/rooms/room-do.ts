import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/**
 * RoomDO — one live conversation: talk, desk, project room or front door (ARCHITECTURE §2.2).
 * Inc 0 STUB: talk runs in WorkspaceDO; rooms arrive in Inc 2.
 */
export class RoomDO extends DurableObject<Env> {
  async ping(): Promise<'pong'> {
    return 'pong';
  }
}
