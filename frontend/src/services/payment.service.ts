/**
 * frontend/src/services/payment.service.ts
 *
 * Axios calls for payment endpoints.
 * Follows the same pattern as sequence.service.ts.
 *
 * SECURITY: This file NEVER stores or handles RAZORPAY_KEY_SECRET.
 *           It only receives the public key_id from the backend.
 */

import api from './api';

// ─── Types ──────────────────────────────────────────────────────────────

export interface CreateOrderResponse {
  order_id:      string;
  amount:        number;   // paise
  currency:      string;
  key_id:        string;   // public key — safe for Checkout
  payment_db_id: string;
}

export interface VerifyPaymentRequest {
  razorpay_order_id:   string;
  razorpay_payment_id: string;
  razorpay_signature:  string;
}

export interface VerifyPaymentResponse {
  plan:            string;
  plan_started_at: string;
}

export interface PlanData {
  plan:            'free' | 'pro';
  plan_started_at: string | null;
  plan_expires_at: string | null;
}

export interface PaymentHistoryItem {
  id:                string;
  plan:              string;
  amount:            number;
  currency:          string;
  status:            'created' | 'paid' | 'failed';
  environment:       'test' | 'live';
  razorpay_order_id: string;
  created_at:        string;
  paid_at?:          string;
}

// ─── Service ────────────────────────────────────────────────────────────

export const paymentService = {

  /**
   * POST /api/payments/create-order
   * Creates a Razorpay TEST order on the backend.
   * Returns the order_id and public key_id — never the secret.
   */
  createOrder: async (plan: 'pro'): Promise<CreateOrderResponse> => {
    const response = await api.post('/payments/create-order', { plan });
    return response.data.data;
  },

  /**
   * POST /api/payments/verify
   * Sends the three Razorpay Checkout success fields to the backend.
   * Backend verifies HMAC-SHA256 signature before updating plan.
   * NEVER call this without receiving data from Razorpay Checkout first.
   */
  verifyPayment: async (data: VerifyPaymentRequest): Promise<VerifyPaymentResponse> => {
    const response = await api.post('/payments/verify', data);
    return response.data.data;
  },

  /**
   * GET /api/payments/plan
   * Returns the authenticated user's current plan and entitlement state.
   */
  getCurrentPlan: async (): Promise<PlanData> => {
    const response = await api.get('/payments/plan');
    return response.data.data;
  },

  /**
   * GET /api/payments/history
   * Returns the user's last 50 payment records.
   */
  getHistory: async (): Promise<PaymentHistoryItem[]> => {
    const response = await api.get('/payments/history');
    return response.data.data || [];
  },
};
