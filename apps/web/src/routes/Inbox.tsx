// Inbox: raised hands only (decisions), so it can reach zero (X1). None exist in Inc 0.
import { Icon } from '../components/Icon';
import { raisedHands } from '../store';
import './pages.css';

export function Inbox() {
  const count = raisedHands.value;
  return (
    <section class="page inbox" aria-labelledby="inbox-title">
      <header class="page-head">
        <h1 id="inbox-title">Inbox</h1>
      </header>
      {count === 0 && (
        <div class="panel empty">
          <Icon name="inbox" size={28} class="empty-icon" />
          <p class="empty-title">Nothing needs you</p>
          <p class="empty-text">When a coworker needs a decision from you, it arrives here as a raised hand, and their face shows the hand too. Updates stay in Talk, so this only fills when you are needed.</p>
        </div>
      )}
    </section>
  );
}
