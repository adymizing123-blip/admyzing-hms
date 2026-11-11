'use client';
import { createContext, useContext } from 'react';

/** Current branch for the signed-in staff member. Lists that belong to a branch filter by it. */
export const BranchContext = createContext<{ branchId: string | null; branches: { id: string; name: string }[] }>({ branchId: null, branches: [] });
export const useBranch = () => useContext(BranchContext);
