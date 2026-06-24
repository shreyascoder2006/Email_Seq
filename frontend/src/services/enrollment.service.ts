import api from './api';
import type { 
  SequenceContact, 
  EnrollContactsDto, 
  PaginatedResponse
} from '../types';

export const enrollmentService = {
  listContacts: async (
    sequenceId: string, 
    params?: { page?: number; limit?: number; status?: string; search?: string }
  ): Promise<PaginatedResponse<SequenceContact>> => {
    const response = await api.get(`/sequences/${sequenceId}/contacts`, { params });
    const payload = response.data;
    return {
      data: payload.data || [],
      total: payload.meta?.total || payload.data?.length || 0,
      page: payload.meta?.page || 1,
      limit: payload.meta?.limit || 50,
      total_pages: payload.meta?.totalPages || 1,
    };
  },

  enroll: async (sequenceId: string, data: EnrollContactsDto) => {
    const response = await api.post(`/sequences/${sequenceId}/enroll`, data);
    return response.data;
  },

  patchStatus: async (
    sequenceId: string, 
    contactId: string, 
    status: 'active' | 'paused' | 'removed', 
    reason?: string
  ): Promise<SequenceContact> => {
    const response = await api.patch(`/sequences/${sequenceId}/contacts/${contactId}`, { status, reason });
    return response.data.data || response.data;
  },

  bulkDelete: async (sequenceId: string, contactIds: string[]) => {
    const response = await api.post(`/sequences/${sequenceId}/contacts/bulk-delete`, { contactIds });
    return response.data;
  },

  bulkPause: async (sequenceId: string, contactIds: string[]) => {
    const response = await api.patch(`/sequences/${sequenceId}/contacts/pause`, { contactIds });
    return response.data;
  },

  bulkResume: async (sequenceId: string, contactIds: string[]) => {
    const response = await api.patch(`/sequences/${sequenceId}/contacts/resume`, { contactIds });
    return response.data;
  },
};
