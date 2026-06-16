import { create } from 'zustand';
import type { User } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
  getCurrentUser: () => User | null;
}

export const useAuthStore = create<AuthState>((set, get) => {
  // Initialize from local storage if available
  const storedToken = localStorage.getItem('token');
  const storedUser = localStorage.getItem('user');

  return {
    token: storedToken,
    user: storedUser ? JSON.parse(storedUser) : null,
    isLoading: false,

    login: (token: string, user: User) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      set({ token, user });
    },

    logout: () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      set({ token: null, user: null });
    },

    isAuthenticated: () => {
      return !!get().token;
    },

    getCurrentUser: () => {
      return get().user;
    },
  };
});
