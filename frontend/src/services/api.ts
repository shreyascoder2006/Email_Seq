import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';

// Create an Axios instance
const api = axios.create({
  baseURL: 'http://localhost:5000/api', // Backend URL as requested
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to attach the Bearer token
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle 401 Unauthorized
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear auth state and redirect to login
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
