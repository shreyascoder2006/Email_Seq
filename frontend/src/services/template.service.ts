import api from './api';
import type { Template, CreateTemplateDto, UpdateTemplateDto } from '../types';

export const templateService = {
  list: async (): Promise<Template[]> => {
    const response = await api.get('/templates');
    return response.data.data || response.data || [];
  },

  get: async (id: string): Promise<Template> => {
    const response = await api.get(`/templates/${id}`);
    return response.data.data || response.data;
  },

  create: async (data: CreateTemplateDto): Promise<Template> => {
    const response = await api.post('/templates', data);
    return response.data.data || response.data;
  },

  update: async (id: string, data: UpdateTemplateDto): Promise<Template> => {
    const response = await api.put(`/templates/${id}`, data);
    return response.data.data || response.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/templates/${id}`);
  },

  preview: async (id: string): Promise<{ html: string; subject: string }> => {
    const response = await api.post(`/templates/${id}/preview`);
    return response.data.data || response.data;
  },
};
