/**
 * frontend/src/store/usePlanStore.ts
 *
 * Zustand store for the user's current plan / entitlement state.
 * Kept separate from useAuthStore so plan state can be refreshed
 * independently after a successful payment without touching the JWT.
 */

import { create } from 'zustand';
import type { PlanData } from '../services/payment.service';

interface PlanState {
  plan:            'free' | 'pro' | null;   // null = not yet fetched
  plan_started_at: string | null;
  plan_expires_at: string | null;
  isLoading:       boolean;
  error:           string | null;

  // Actions
  setPlan:    (data: PlanData) => void;
  setLoading: (loading: boolean) => void;
  setError:   (error: string | null) => void;
  reset:      () => void;

  // Derived helpers
  isPro:  () => boolean;
  isFree: () => boolean;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  plan:            null,
  plan_started_at: null,
  plan_expires_at: null,
  isLoading:       false,
  error:           null,

  setPlan: (data: PlanData) =>
    set({
      plan:            data.plan,
      plan_started_at: data.plan_started_at,
      plan_expires_at: data.plan_expires_at,
      error:           null,
    }),

  setLoading: (loading: boolean) => set({ isLoading: loading }),

  setError: (error: string | null) => set({ error }),

  reset: () =>
    set({
      plan:            null,
      plan_started_at: null,
      plan_expires_at: null,
      isLoading:       false,
      error:           null,
    }),

  isPro:  () => get().plan === 'pro',
  isFree: () => get().plan === 'free' || get().plan === null,
}));
