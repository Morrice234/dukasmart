import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getDb, getMeta, setMeta } from '../db/database';
import { useLiveQuery } from '../hooks/useData';
import { useAuth } from './AuthContext';

const BranchContext = createContext(null);

async function loadBranches() {
  const db = await getDb();
  return db.getAllAsync('SELECT * FROM branches WHERE deleted = 0 ORDER BY created_at');
}

// Which branch the screens are showing. 'all' means every branch (owners and all-branch managers).
export function BranchProvider({ children }) {
  const { employee, token } = useAuth();
  const branches = useLiveQuery(loadBranches, [token]) || [];
  const [selected, setSelected] = useState('all');
  const lockedBranch = employee && employee.branchId ? employee.branchId : null;

  useEffect(() => {
    getMeta('current_branch').then((v) => v && setSelected(v));
  }, [token]);

  const current = lockedBranch
    || (selected !== 'all' && branches.some((b) => b.id === selected) ? selected : (branches.length > 1 ? 'all' : (branches[0] && branches[0].id) || 'all'));

  const value = useMemo(() => ({
    branches,
    current, // branch id or 'all'
    branchFilter: current === 'all' ? null : current,
    currentBranch: branches.find((b) => b.id === current) || null,
    canSwitch: !lockedBranch && branches.length > 1,
    // Where new records go when 'all' is showing
    defaultBranchId: current !== 'all' ? current : (branches[0] && branches[0].id) || null,
    setCurrent: async (id) => {
      setSelected(id);
      await setMeta('current_branch', id);
    },
    branchName: (id) => (branches.find((b) => b.id === id) || {}).name || '',
  }), [branches, current, lockedBranch]);

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch() {
  return useContext(BranchContext);
}
