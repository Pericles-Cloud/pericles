import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` during SSR and the first (hydrating) client render, `true` after.
 *
 * Needed wherever markup depends on a client-only value — next-themes' `theme`
 * is undefined on the server, so rendering the selected state directly would
 * produce a hydration mismatch.
 *
 * Deliberately NOT the `useState(false)` + `useEffect(() => setMounted(true))`
 * idiom: that sets state synchronously inside an effect, which triggers a
 * cascading re-render and is rejected by the repo's
 * `react-hooks/set-state-in-effect` rule. useSyncExternalStore gives the same
 * answer in one render with no effect at all.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
