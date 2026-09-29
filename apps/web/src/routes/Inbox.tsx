// Inbox: raised hands only (decisions), so it can reach zero (X1): plans to approve, teammates' questions, review
// issues and deliverables that need the owner's call, and spent budgets. Updates stay in Talk.
import { useEffect } from 'preact/hooks';
import { loadCatalog } from '../catalog';
import { chiefName } from '../chief';
import { DecisionCard } from '../components/DecisionCard';
import { Icon } from '../components/Icon';
import { decisionList } from '../store';
import './pages.css';

export function Inbox() {
  useEffect(() => void loadCatalog(), []);
  const decisions = decisionList.value;
  const name = chiefName.value;
  const questions = decisions.some((d) => d.kind === 'input');
  return (
    <section class="page inbox" aria-labelledby="inbox-title">
      <header class="page-head">
        <h1 id="inbox-title">Inbox</h1>
        {decisions.length > 0 && <p class="page-lede">{decisions.length === 1 ? 'One decision needs you.' : `${decisions.length} decisions need you.`}</p>}
      </header>
      {decisions.length === 0 && (
        <div class="panel empty">
          <Icon name="inbox" size={28} class="empty-icon" />
          <p class="empty-title">Nothing needs you</p>
          <p class="empty-text">When a coworker needs a decision from you, it arrives here as a raised hand, and their face shows the hand too. Updates stay in Talk, so this only fills when you are needed.</p>
        </div>
      )}
      <div class="decision-list">
        {decisions.map((d) => (
          <DecisionCard key={d.decisionId} decision={d} />
        ))}
      </div>
      {decisions.length > 0 && <p class="page-fine">{questions ? `You can also just answer ${name} in Talk.` : `You can also just tell ${name} “go ahead”.`}</p>}
    </section>
  );
}
