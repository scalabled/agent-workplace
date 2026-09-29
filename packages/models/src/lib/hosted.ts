// Which provider-hosted tools a request may carry (web search): the adapters call this so a provider never gets a
// hosted tool it cannot run, and a `solo` one (Gemini grounding) never rides along with function tools.
import type { ChatRequest, HostedSupport, HostedTool } from '../types';

export function hostedFor(req: ChatRequest, support: HostedSupport | undefined, withFunctions: boolean): HostedTool[] {
  if (req.toolChoice === 'none' || !req.hostedTools?.length || !support) return [];
  return req.hostedTools.filter((t) => {
    const s = support[t.type];
    return s === 'with_tools' || (s === 'solo' && !withFunctions);
  });
}
