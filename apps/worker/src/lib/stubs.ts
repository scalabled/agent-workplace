import { EVERYDAY_PROJECT_ID, doNames, type ProjectId } from '@headcount/protocol';
import type { Env } from '../env';

/** The workspace's WorkspaceDO (tenant, owner feed, talk in Inc 0). */
export function workspaceStub(env: Env) {
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(doNames.workspace(env.WORKSPACE_ID)));
}

/** A project's ProjectDO; Everyday by default. */
export function projectStub(env: Env, projectId: ProjectId = EVERYDAY_PROJECT_ID) {
  return env.PROJECT.get(env.PROJECT.idFromName(doNames.project(env.WORKSPACE_ID, projectId)));
}

export function roomStub(env: Env, roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(doNames.room(roomId)));
}

export function runStub(env: Env, jobId: string) {
  return env.RUN.get(env.RUN.idFromName(doNames.run(jobId)));
}
