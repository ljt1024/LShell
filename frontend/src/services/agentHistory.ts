import type { AgentPlanHistoryItem } from "../types/protocol";

const AGENT_HISTORY_KEY = "lshell-agent-plan-history";
const MAX_HISTORY_ITEMS = 20;

export function readAgentHistory(): AgentPlanHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(AGENT_HISTORY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as AgentPlanHistoryItem[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isHistoryItem).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    clearAgentHistory();
    return [];
  }
}

export function writeAgentHistory(items: AgentPlanHistoryItem[]): AgentPlanHistoryItem[] {
  const normalized = items.filter(isHistoryItem).slice(0, MAX_HISTORY_ITEMS);
  window.localStorage.setItem(AGENT_HISTORY_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearAgentHistory(): void {
  window.localStorage.removeItem(AGENT_HISTORY_KEY);
}

export function upsertAgentHistoryItem(
  items: AgentPlanHistoryItem[],
  item: AgentPlanHistoryItem
): AgentPlanHistoryItem[] {
  return [item, ...items.filter((current) => current.id !== item.id)].slice(0, MAX_HISTORY_ITEMS);
}

function isHistoryItem(value: unknown): value is AgentPlanHistoryItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as AgentPlanHistoryItem;
  return (
    typeof item.id === "string" &&
    typeof item.intent === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    typeof item.executionStatus === "string" &&
    Boolean(item.plan) &&
    typeof item.plan.id === "string" &&
    Array.isArray(item.plan.steps) &&
    Boolean(item.stepStates) &&
    typeof item.stepStates === "object"
  );
}
