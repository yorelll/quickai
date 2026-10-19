/**
 * Renders an [`AgentAction`] as localized, human-readable text.
 *
 * The backend ships structured actions (never English prose), so this is the
 * single place that turns them into copy — always through the dictionary.
 */
import type { Translate } from '../i18n';
import type { AgentAction } from '../types/agent';

/** Localizes a scroll direction ("up" | "down", or anything else verbatim). */
function formatDirection(direction: string, t: Translate): string {
  if (direction === 'up') return t('agent.direction.up');
  if (direction === 'down') return t('agent.direction.down');
  return direction;
}

export function formatAgentAction(action: AgentAction, t: Translate): string {
  switch (action.type) {
    case 'click':
      return t('agent.action.click', { x: action.x, y: action.y });
    case 'double_click':
      return t('agent.action.doubleClick', { x: action.x, y: action.y });
    case 'right_click':
      return t('agent.action.rightClick', { x: action.x, y: action.y });
    case 'drag':
      return t('agent.action.drag', {
        x1: action.x1,
        y1: action.y1,
        x2: action.x2,
        y2: action.y2,
      });
    case 'type':
      return t('agent.action.type', { text: action.text });
    case 'key_press':
      return t('agent.action.keyPress', { combo: action.combo });
    case 'scroll':
      return t('agent.action.scroll', {
        direction: formatDirection(action.direction, t),
        amount: action.amount,
      });
    case 'launch':
      return t('agent.action.launch', { app: action.app });
    case 'list_dir':
      return t('agent.action.listDir', { path: action.path });
    case 'done':
      return t('agent.action.done');
  }
}
