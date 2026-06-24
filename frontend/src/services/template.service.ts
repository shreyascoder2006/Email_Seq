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

  getMergeTags: async (): Promise<{ 
    contact: { tag: string, label: string, desc: string }[], 
    custom: { tag: string, label: string, desc: string }[],
    sender: { tag: string, label: string, desc: string }[],
    sequence: { tag: string, label: string, desc: string }[]
  }> => {
    const response = await api.get('/templates/merge-tags');
    return response.data.data || response.data;
  },

  preview: async (id: string): Promise<{ html: string; subject: string }> => {
    const response = await api.post(`/templates/${id}/preview`);
    return response.data.data || response.data;
  },

  previewRaw: async (data: { html: string; subject: string }): Promise<{ html: string; subject: string }> => {
    const response = await api.post(`/templates/raw/preview`, data);
    return response.data.data || response.data;
  },

  createCustomMergeTag: async (data: { key: string, label: string }): Promise<any> => {
    const response = await api.post('/templates/merge-tags/custom', data);
    return response.data.data || response.data;
  },
};
