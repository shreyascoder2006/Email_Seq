import api from './api';
import type { Sequence, CreateSequenceDto, PaginatedResponse, SequenceStep, CreateStepDto, UpdateStepDto, ReorderStepsDto } from '../types';

export const sequenceService = {
  // List sequences with pagination, search, and filters
  list: async (params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  }): Promise<PaginatedResponse<Sequence>> => {
    const response = await api.get('/sequences', { params });
    const payload = response.data;
    return {
      data: payload.data || [],
      total: payload.meta?.total || 0,
      page: payload.meta?.page || 1,
      limit: payload.meta?.limit || 10,
      total_pages: payload.meta?.totalPages || 1,
    };
  },

  // Get single sequence
  get: async (id: string): Promise<Sequence> => {
    const response = await api.get(`/sequences/${id}`);
    return response.data.data || response.data;
  },

  // Create sequence
  create: async (data: CreateSequenceDto): Promise<Sequence> => {
    const response = await api.post('/sequences', data);
    return response.data.data || response.data;
  },

  // Update sequence status
  updateStatus: async (id: string, status: Sequence['status']): Promise<Sequence> => {
    const response = await api.patch(`/sequences/${id}/status`, { status });
    return response.data.data || response.data;
  },

  // Delete sequence
  delete: async (id: string): Promise<void> => {
    await api.delete(`/sequences/${id}`);
  },

  // Get sequence with steps
  getWithSteps: async (id: string): Promise<{ sequence: Sequence; steps: SequenceStep[] }> => {
    const response = await api.get(`/sequences/${id}`);
    return response.data.data || response.data;
  },

  // Add step
  addStep: async (sequenceId: string, data: CreateStepDto): Promise<SequenceStep> => {
    const response = await api.post(`/sequences/${sequenceId}/steps`, data);
    return response.data.data || response.data;
  },

  // Update step
  updateStep: async (sequenceId: string, stepId: string, data: UpdateStepDto): Promise<SequenceStep> => {
    const response = await api.put(`/sequences/${sequenceId}/steps/${stepId}`, data);
    return response.data.data || response.data;
  },

  // Delete step
  deleteStep: async (sequenceId: string, stepId: string): Promise<void> => {
    await api.delete(`/sequences/${sequenceId}/steps/${stepId}`);
  },

  // Reorder steps
  reorderSteps: async (sequenceId: string, data: ReorderStepsDto): Promise<SequenceStep[]> => {
    const response = await api.patch(`/sequences/${sequenceId}/steps/reorder`, data);
    return response.data.data || response.data;
  },
};

