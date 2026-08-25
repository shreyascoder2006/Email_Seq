/**
 * frontend/src/pages/Billing.tsx
 *
 * SaaS Billing & Plan page.
 *
 * Features:
 *   - Prominent TEST MODE banner
 *   - Current plan display with feature list
 *   - PRO plan card with upgrade CTA
 *   - Razorpay Checkout integration (official script, not custom UI)
 *   - Payment history table
 *   - Success / failure toast notifications
 *
 * Razorpay Checkout is loaded via the official CDN script tag.
 * No Razorpay npm package is used on the frontend.
 * RAZORPAY_KEY_SECRET is never present in this file.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { CreditCard, Check, X, AlertTriangle, Zap, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { usePlanStore } from '../store/usePlanStore';
import { paymentService, type PaymentHistoryItem } from '../services/payment.service';

// ─── Razorpay global type ────────────────────────────────────────────────
// Razorpay Checkout is loaded via <script> tag at runtime.
// These types allow TypeScript to understand window.Razorpay.
declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayOptions {
  key:          string;
  amount:       number;
  currency:     string;
  name:         string;
  description:  string;
  order_id:     string;
  theme:        { color: string };
  modal:        { ondismiss: () => void };
  handler:      (response: RazorpaySuccessResponse) => void;
  notes?:       Record<string, string>;
}

interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id:   string;
  razorpay_signature:  string;
}

interface RazorpayInstance {
  open:  () => void;
  close: () => void;
  on:    (event: string, handler: () => void) => void;
}

// ─── Plan feature lists ──────────────────────────────────────────────────
const PLAN_FEATURES = {
  free: [
    { label: '3 sequences',          included: true  },
    { label: '100 contacts',          included: true  },
    { label: '50 emails / day',       included: true  },
    { label: '5 AI generations / day',included: true  },
    { label: 'Basic analytics',       included: true  },
    { label: 'Advanced analytics',    included: false },
    { label: '10,000 contacts',       included: false },
    { label: '1,000 emails / day',    included: false },
  ],
  pro: [
    { label: '50 sequences',          included: true },
    { label: '10,000 contacts',       included: true },
    { label: '1,000 emails / day',    included: true },
    { label: '100 AI generations / day', included: true },
    { label: 'Advanced analytics',    included: true },
    { label: 'Priority support',      included: true },
    { label: 'All future features',   included: true },
  ],
};

// ─── Utility ─────────────────────────────────────────────────────────────
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload  = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

function formatAmount(paise: number, currency: string): string {
  const amount = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day:   'numeric',
    month: 'short',
    year:  'numeric',
  });
}

// ════════════════════════════════════════════════════════════════════════
//  Billing Page Component
// ════════════════════════════════════════════════════════════════════════
export const Billing: React.FC = () => {
  const { plan, plan_started_at, setPlan, setLoading, isLoading } = usePlanStore();
  const [history, setHistory]           = useState<PaymentHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // ── Load current plan on mount ─────────────────────────────────────
  const fetchPlan = useCallback(async () => {
    setLoading(true);
    try {
      const data = await paymentService.getCurrentPlan();
      setPlan(data);
    } catch {
      // Silently fail — plan defaults to free in store
    } finally {
      setLoading(false);
    }
  }, [setLoading, setPlan]);

  // ── Load payment history ───────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await paymentService.getHistory();
      setHistory(data);
    } catch {
      // Non-critical — history table stays empty
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlan();
    fetchHistory();
  }, [fetchPlan, fetchHistory]);

  // ── Razorpay Checkout flow ─────────────────────────────────────────
  const handleUpgrade = useCallback(async () => {
    setCheckoutLoading(true);

    try {
      // 1. Load Razorpay script (idempotent if already loaded)
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        toast.error('Could not load payment gateway. Please check your connection.');
        return;
      }

      // 2. Create order on backend — gets real Razorpay TEST order ID
      const order = await paymentService.createOrder('pro');

      // 3. Configure Razorpay Checkout options
      const options: RazorpayOptions = {
        key:         order.key_id,           // public key — safe
        amount:      order.amount,           // in paise (99900 = ₹999)
        currency:    order.currency,
        name:        'MailSequence',
        description: 'Pro Plan — TEST MODE',
        order_id:    order.order_id,
        theme:       { color: '#4f46e5' },   // indigo to match app primary
        modal: {
          ondismiss: () => {
            // User closed the modal without paying
            toast('Payment cancelled. Your plan remains unchanged.', {
              icon: '↩️',
            });
            setCheckoutLoading(false);
          },
        },

        // 4. On Checkout success — Razorpay calls this with THREE fields
        //    We immediately send them to the backend for verification.
        //    We NEVER trust this callback alone to upgrade the plan.
        handler: async (response: RazorpaySuccessResponse) => {
          try {
            const verified = await paymentService.verifyPayment({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_signature:  response.razorpay_signature,
            });

            // Only update local plan state AFTER backend verification succeeds
            setPlan({
              plan:            verified.plan as 'free' | 'pro',
              plan_started_at: verified.plan_started_at,
              plan_expires_at: null,
            });

            toast.success('🎉 PRO activated! Welcome to MailSequence Pro.');
            fetchHistory(); // Refresh payment history
          } catch {
            toast.error(
              'Payment was received but verification failed. Please contact support.'
            );
          } finally {
            setCheckoutLoading(false);
          }
        },
      };

      // 5. Open the official Razorpay Checkout modal
      const razorpay = new window.Razorpay(options);
      razorpay.open();

    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Could not initiate payment. Please try again.';
      toast.error(message);
      setCheckoutLoading(false);
    }
  }, [setPlan, fetchHistory]);

  // ─── Render ──────────────────────────────────────────────────────────
  const currentPlan = plan ?? 'free';
  const isPro       = currentPlan === 'pro';

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ── TEST MODE Banner ─────────────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-semibold text-amber-800">
            Test Mode — No real payments will be processed
          </p>
          <p className="mt-0.5 text-sm text-amber-700">
            Payments are simulated through Razorpay&apos;s sandbox environment.
            Use Razorpay test card <span className="font-mono font-medium">4111 1111 1111 1111</span> with
            any future expiry and CVV.
          </p>
        </div>
      </div>

      {/* ── Current Plan Card ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>Current Plan</CardTitle>
            <CardDescription>Your active plan and included features</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { fetchPlan(); fetchHistory(); }}
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600"
            title="Refresh plan status"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-6">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
              isPro ? 'bg-indigo-100' : 'bg-gray-100'
            }`}>
              <Zap className={`h-5 w-5 ${isPro ? 'text-indigo-600' : 'text-gray-500'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-gray-900">
                  {isPro ? 'PRO' : 'FREE'}
                </span>
                {isPro && (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    Active
                  </span>
                )}
              </div>
              {isPro && plan_started_at && (
                <p className="text-xs text-gray-500">
                  Activated {formatDate(plan_started_at)}
                </p>
              )}
            </div>
          </div>

          {/* Feature list */}
          <ul className="space-y-2 mb-6">
            {PLAN_FEATURES[currentPlan].map((f) => (
              <li key={f.label} className="flex items-center gap-2 text-sm">
                {f.included ? (
                  <Check className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <X className="h-4 w-4 text-gray-300 shrink-0" />
                )}
                <span className={f.included ? 'text-gray-700' : 'text-gray-400'}>
                  {f.label}
                </span>
              </li>
            ))}
          </ul>

          {/* Upgrade CTA — hidden when already PRO */}
          {!isPro && (
            <Button
              id="upgrade-to-pro-btn"
              size="lg"
              onClick={handleUpgrade}
              isLoading={checkoutLoading}
              disabled={checkoutLoading}
              className="w-full sm:w-auto"
            >
              <Zap className="mr-2 h-4 w-4" />
              Upgrade to Pro — ₹999
            </Button>
          )}

          {isPro && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <Check className="h-4 w-4" />
              You&apos;re on the Pro plan. All features unlocked.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── PRO Plan Details Card (visible only on free plan) ────────── */}
      {!isPro && (
        <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-white">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-indigo-900">PRO Plan</CardTitle>
                <CardDescription className="text-indigo-600">
                  Everything in Free, plus:
                </CardDescription>
              </div>
              <div className="text-right">
                <span className="text-3xl font-bold text-indigo-900">₹999</span>
                <p className="text-xs text-indigo-500">one-time · test mode</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 mb-6">
              {PLAN_FEATURES.pro.map((f) => (
                <li key={f.label} className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-indigo-500 shrink-0" />
                  <span className="text-indigo-800">{f.label}</span>
                </li>
              ))}
            </ul>
            <Button
              id="upgrade-to-pro-btn-2"
              size="lg"
              onClick={handleUpgrade}
              isLoading={checkoutLoading}
              disabled={checkoutLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Upgrade to Pro — ₹999
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Payment History ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
          <CardDescription>All transactions for your account</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-gray-400">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Loading history…
            </div>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              No payment records yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Plan</th>
                    <th className="pb-3 pr-4">Amount</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3">Order ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {history.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-4 text-gray-700">
                        {formatDate(p.created_at)}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="capitalize font-medium text-gray-800">
                          {p.plan}
                        </span>
                        {p.environment === 'test' && (
                          <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                            test
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-gray-700">
                        {formatAmount(p.amount, p.currency)}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.status === 'paid'
                            ? 'bg-green-100 text-green-700'
                            : p.status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {p.status === 'paid' && <Check className="h-3 w-3" />}
                          {p.status === 'failed' && <X className="h-3 w-3" />}
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 font-mono text-xs text-gray-400 truncate max-w-[160px]">
                        {p.razorpay_order_id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
};
