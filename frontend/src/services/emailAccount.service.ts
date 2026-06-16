import api from './api';
import type { EmailConnection, CreateEmailConnectionDto, UpdateEmailConnectionDto } from '../types';

export const emailAccountService = {
  list: async (): Promise<EmailConnection[]> => {
    const response = await api.get('/email-accounts');
    return response.data.data || response.data || [];
  },
  
  get: async (id: string): Promise<EmailConnection> => {
    const response = await api.get(`/email-accounts/${id}`);
    return response.data.data || response.data;
  },

  create: async (data: CreateEmailConnectionDto): Promise<EmailConnection> => {
    const response = await api.post('/email-accounts', data);
    return response.data.data || response.data;
  },

  update: async (id: string, data: UpdateEmailConnectionDto): Promise<EmailConnection> => {
    const response = await api.put(`/email-accounts/${id}`, data);
    return response.data.data || response.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/email-accounts/${id}`);
  },

  testConnection: async (id: string, testImap: boolean = false): Promise<{ success: boolean; message: string }> => {
    const response = await api.post(`/email-accounts/${id}/test`, { test_imap: testImap });
    return response.data;
  },
};
