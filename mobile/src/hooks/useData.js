import { useCallback, useEffect, useState } from 'react';
import { on } from '../events';
import { getSyncState } from '../sync/syncEngine';

// Runs `loader` now and again whenever local data changes (writes or sync pulls)
export function useLiveQuery(loader, deps = []) {
  const [data, setData] = useState(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  useEffect(() => {
    let alive = true;
    const run = () => load().then((d) => alive && setData(d)).catch((e) => console.warn(e));
    run();
    const off = on('data', run);
    return () => { alive = false; off(); };
  }, [load]);

  return data;
}

export function useSyncState() {
  const [state, setState] = useState(getSyncState());
  useEffect(() => on('sync-state', setState), []);
  return state;
}
