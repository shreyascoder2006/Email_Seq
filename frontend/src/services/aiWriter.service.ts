import api from './api';

export type EmailLength = 'short' | 'medium' | 'long';

export interface GenerateEmailRequest {
  objective: string;
  length: EmailLength;
  offering: string;
  audience: string;
  painPoint: string;
  cta: string;
  guidance: string;
}

export interface GenerateEmailResponse {
  subject: string;
  bodyHtml: string;
}

export const aiWriterService = {
  generateEmail: async (data: GenerateEmailRequest): Promise<GenerateEmailResponse> => {
    const response = await api.post('/ai/generate-email', data);
    return response.data.data || response.data;
  }
};
