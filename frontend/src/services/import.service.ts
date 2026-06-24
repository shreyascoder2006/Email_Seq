import api from './api';
import type {
  ImportList,
  ImportedContact,
  ParsePreviewResult,
  ImportSaveResult,
  CreateImportListDto,
  EnrollImportResult,
} from '../types';

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export const importService = {
  /**
   * Upload a CSV/XLSX file → get headers, 5-row preview, and auto field mappings.
   * Nothing is persisted at this stage.
   */
  async parsePreview(file: File): Promise<ParsePreviewResult> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await api.post<ApiResponse<ParsePreviewResult>>(
      '/imports/parse-preview',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return res.data.data;
  },

  /**
   * Save import list with field mappings + all rows.
   */
  async create(dto: CreateImportListDto): Promise<ImportSaveResult> {
    const res = await api.post<ApiResponse<ImportSaveResult>>('/imports', dto);
    return res.data.data;
  },

  /**
   * List all import lists for the current user.
   */
  async list(): Promise<ImportList[]> {
    const res = await api.get<ApiResponse<ImportList[]>>('/imports');
    return res.data.data;
  },

  /**
   * Get single import list with first 100 contacts.
   */
  async get(id: string): Promise<{ import_list: ImportList; contacts: ImportedContact[]; total: number }> {
    const res = await api.get<ApiResponse<{ import_list: ImportList; contacts: ImportedContact[]; total: number }>>(
      `/imports/${id}`
    );
    return res.data.data;
  },

  /**
   * Delete an import list and all its contacts.
   */
  async delete(id: string): Promise<void> {
    await api.delete(`/imports/${id}`);
  },

  /**
   * Enroll all valid contacts from an import list into a sequence.
   */
  async enroll(
    listId: string,
    sequenceId: string,
    startAt?: string
  ): Promise<EnrollImportResult> {
    const res = await api.post<ApiResponse<EnrollImportResult>>(
      `/imports/${listId}/enroll/${sequenceId}`,
      { start_at: startAt }
    );
    return res.data.data;
  },

  /**
   * Clone an import list and all its contacts.
   */
  async clone(listId: string): Promise<{ new_list_id: string; copied_count: number }> {
    const res = await api.post<ApiResponse<{ new_list_id: string; copied_count: number }>>(
      `/imports/${listId}/clone`
    );
    return res.data.data;
  },

  /**
   * Update import list settings (name, description).
   */
  async updateSettings(listId: string, data: { name?: string; description?: string }): Promise<ImportList> {
    const res = await api.patch<ApiResponse<ImportList>>(
      `/imports/${listId}/settings`,
      data
    );
    return res.data.data;
  },
};
