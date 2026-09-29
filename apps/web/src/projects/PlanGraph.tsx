// The plan as a graph (biz-bot parity: graph.js Plan view): columns by dependency depth, one card per step coloured by
// status, edges from each input to the step that needs it, and the deliverable at the end. Live with the project.
import type { ProjectStep, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { STEP_STATUS_WORDS } from '../components/ProjectCard';

const W = 176;
const H = 52;
const GX = 44;
const GY = 16;

/** Depth of each step: 0 without inputs, else one more than its deepest input (cycles cannot occur in a plan). */
export function levelsOf(steps: readonly ProjectStep[]): Map<string, number> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const level = new Map<string, number>();
  const visit = (s: ProjectStep, seen: Set<string>): number => {
    const known = level.get(s.id);
    if (known !== undefined) return known;
    if (seen.has(s.id)) return 0;
    seen.add(s.id);
    const deps = s.dependsOn.map((d) => byId.get(d)).filter((d): d is ProjectStep => !!d);
    const l = deps.length ? 1 + Math.max(...deps.map((d) => visit(d, seen))) : 0;
    level.set(s.id, l);
    return l;
  };
  for (const s of steps) visit(s, new Set());
  return level;
}

export function PlanGraph({ project, onSelect }: { project: TeamProjectSnapshot; onSelect?: (stepId: string) => void }) {
  const steps = project.steps;
  if (!steps.length) return null;
  const level = levelsOf(steps);
  const cols = Math.max(...level.values()) + 1;
  const rows = new Map<number, string[]>();
  for (const s of steps) rows.set(level.get(s.id)!, [...(rows.get(level.get(s.id)!) ?? []), s.id]);
  const maxRows = Math.max(...[...rows.values()].map((r) => r.length));
  const pos = new Map<string, { x: number; y: number }>();
  for (const [l, ids] of rows) ids.forEach((id, i) => pos.set(id, { x: l * (W + GX), y: i * (H + GY) + ((maxRows - ids.length) * (H + GY)) / 2 }));
  const finalX = cols * (W + GX);
  const finalY = ((maxRows - 1) * (H + GY)) / 2;
  const width = finalX + 130;
  const height = maxRows * (H + GY) - GY;
  const sinks = steps.filter((s) => !steps.some((o) => o.dependsOn.includes(s.id)));
  const index = new Map(steps.map((s, i) => [s.id, i + 1]));
  const edge = (from: { x: number; y: number }, to: { x: number; y: number }, key: string, cls: string) => {
    const x1 = from.x + W;
    const y1 = from.y + H / 2;
    const x2 = to.x;
    const y2 = to.y + H / 2;
    const mx = (x1 + x2) / 2;
    return <path key={key} class={`plan-edge ${cls}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
  };
  return (
    <div class="plan-graph" role="img" aria-label={`The plan as a graph: ${steps.map((s) => `${index.get(s.id)}. ${s.title} (${STEP_STATUS_WORDS[s.status]})`).join('; ')}`}>
      <svg viewBox={`-2 -2 ${width + 4} ${height + 4}`} width={width} height={height} aria-hidden="true">
        {steps.flatMap((s) =>
          s.dependsOn
            .filter((d) => pos.has(d))
            .map((d) => {
              const from = steps.find((x) => x.id === d)!;
              return edge(pos.get(d)!, pos.get(s.id)!, `${d}>${s.id}`, from.status === 'done' ? (s.status === 'done' ? 'is-done' : 'is-flow') : from.status === 'failed' || from.status === 'skipped' ? 'is-failed' : '');
            }),
        )}
        {sinks.map((s) => edge(pos.get(s.id)!, { x: finalX, y: finalY }, `${s.id}>final`, s.status === 'done' ? 'is-done' : ''))}
        {steps.map((s) => {
          const p = pos.get(s.id)!;
          return (
            <g key={s.id} class="plan-node" data-status={s.status} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect?.(s.id)}>
              <rect width={W} height={H} rx={10} />
              <text x={12} y={21} class="plan-node-num">
                {index.get(s.id)}
              </text>
              <text x={30} y={21} class="plan-node-title">
                {s.title.length > 22 ? `${s.title.slice(0, 21)}…` : s.title}
              </text>
              <text x={30} y={39} class="plan-node-status">
                {STEP_STATUS_WORDS[s.status]}
              </text>
            </g>
          );
        })}
        <g class="plan-node plan-final" data-status={project.deliverable ? 'done' : 'waiting'} transform={`translate(${finalX},${finalY})`}>
          <rect width={120} height={H} rx={10} />
          <text x={14} y={31} class="plan-node-title">
            Deliverable
          </text>
        </g>
      </svg>
    </div>
  );
}
