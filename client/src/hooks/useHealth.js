import { useCallback, useEffect, useRef, useState } from 'react';
import { getHealth } from '../services/healthApi.js';

export function useHealth() {
  const [state, setState] = useState({ phase: 'loading' });
  const active = useRef(null);
  const check = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ phase: 'loading' });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    try {
      const data = await getHealth(controller.signal);
      if (!controller.signal.aborted) setState({ phase: 'success', data });
    } catch (error) {
      if (active.current !== controller) return;
      if (timedOut) setState({ phase: 'error', message: 'The request timed out. Check the API and database, then retry.' });
      else if (!controller.signal.aborted) setState({ phase: 'error', message: error.message || 'The API is unavailable.' });
    } finally { clearTimeout(timeout); }
  }, []);
  useEffect(() => { check(); return () => { active.current?.abort(); active.current = null; }; }, [check]);
  return { ...state, check };
}
