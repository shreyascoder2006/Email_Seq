import React, { useState } from 'react';
import { X, ChevronRight, ArrowLeft, Zap, Server } from 'lucide-react';
import { Button } from '../ui/Button';
import api from '../../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmtpPrefill {
  smtp_host: string;
  smtp_port: number;
  smtp_encryption: 'tls' | 'ssl' | 'none';
  imap_host?: string;
  imap_port?: number;
  imap_encryption?: 'tls' | 'ssl' | 'none';
}

export type ConnectionMethod = 'oauth' | 'smtp';

interface ConnectionOption {
  id: ConnectionMethod;
  label: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
}

interface Provider {
  id: string;
  name: string;
  shortName: string;
  description: string;
  icon: React.ReactNode;
  methods: ConnectionOption[];
  smtpPrefill?: SmtpPrefill;
}

// ─── Provider Definitions (add more here) ─────────────────────────────────────

const PROVIDERS: Provider[] = [
  {
    id: 'gmail',
    name: 'Google Workspace / Gmail',
    shortName: 'Google',
    description: 'Use your Google Workspace or Gmail account.',
    icon: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    ),
    methods: [
      {
        id: 'oauth',
        label: 'Connect with Google',
        description: 'Recommended. Secure OAuth 2.0 — no password needed.',
        badge: 'Recommended',
        icon: <Zap className="w-5 h-5" />,
      },
      {
        id: 'smtp',
        label: 'Connect using SMTP',
        description: 'Use an App Password for manual SMTP configuration.',
        icon: <Server className="w-5 h-5" />,
      },
    ],
    smtpPrefill: {
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_encryption: 'tls',
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      imap_encryption: 'ssl',
    },
  },
  {
    id: 'outlook',
    name: 'Microsoft Outlook / Office 365',
    shortName: 'Microsoft',
    description: 'Connect using Microsoft 365 SMTP.',
    icon: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect x="0" y="0" width="11" height="11" rx="1" fill="#F35325" />
        <rect x="13" y="0" width="11" height="11" rx="1" fill="#81BC06" />
        <rect x="0" y="13" width="11" height="11" rx="1" fill="#05A6F0" />
        <rect x="13" y="13" width="11" height="11" rx="1" fill="#FFBA08" />
      </svg>
    ),
    methods: [
      {
        id: 'smtp',
        label: 'Connect using SMTP',
        description: 'Configure manually with your Outlook SMTP credentials.',
        icon: <Server className="w-5 h-5" />,
      },
    ],
    smtpPrefill: {
      smtp_host: 'smtp.office365.com',
      smtp_port: 587,
      smtp_encryption: 'tls',
      imap_host: 'outlook.office365.com',
      imap_port: 993,
      imap_encryption: 'ssl',
    },
  },
  {
    id: 'custom',
    name: 'Custom SMTP',
    shortName: 'Custom',
    description: 'Connect any SMTP provider (Zoho, Yahoo, Amazon SES, etc.).',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="#64748b" strokeWidth="1.5" />
        <path d="M2 8l10 7 10-7" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    methods: [
      {
        id: 'smtp',
        label: 'Connect using SMTP',
        description: 'Enter your provider\'s SMTP host, port, and credentials.',
        icon: <Server className="w-5 h-5" />,
      },
    ],
    smtpPrefill: undefined, // no defaults — leave blank
  },
];

// ─── Component Props ───────────────────────────────────────────────────────────

interface ProviderSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSmtp: (prefill?: SmtpPrefill) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ProviderSelectionModal: React.FC<ProviderSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelectSmtp,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

  if (!isOpen) return null;

  const handleProviderClick = (provider: Provider) => {
    // If there's only one method, skip the sub-selection screen and act immediately
    if (provider.methods.length === 1) {
      const method = provider.methods[0];
      if (method.id === 'oauth') {
        window.location.href = `${api.defaults.baseURL}/oauth/${provider.id}/auth`;
      } else {
        onClose();
        onSelectSmtp(provider.smtpPrefill);
      }
    } else {
      setSelectedProvider(provider);
    }
  };

  const handleMethodSelect = (provider: Provider, method: ConnectionMethod) => {
    if (method === 'oauth') {
      window.location.href = `${api.defaults.baseURL}/oauth/${provider.id}/auth`;
    } else {
      onClose();
      onSelectSmtp(provider.smtpPrefill);
    }
  };

  const handleClose = () => {
    setSelectedProvider(null);
    onClose();
  };

  const handleBack = () => {
    setSelectedProvider(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            {selectedProvider && (
              <button
                onClick={handleBack}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 id="provider-modal-title" className="text-xl font-bold text-gray-900">
                {selectedProvider ? `Connect ${selectedProvider.shortName}` : 'Connect Email Account'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {selectedProvider
                  ? 'Choose how you want to connect.'
                  : 'Choose how you would like to connect your email account.'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="px-6 pb-6">
          {!selectedProvider ? (
            /* Provider Grid */
            <div className="grid grid-cols-1 gap-3">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => handleProviderClick(provider)}
                  className="group flex items-center gap-4 w-full text-left p-4 rounded-xl border-2 border-gray-100 hover:border-primary-400 hover:bg-primary-50/40 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {/* Provider icon */}
                  <div className="w-10 h-10 flex-shrink-0">
                    {provider.icon}
                  </div>

                  {/* Provider info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 group-hover:text-primary-700 transition-colors">
                      {provider.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {provider.description}
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary-500 flex-shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          ) : (
            /* Method Cards for selected provider */
            <div className="grid grid-cols-1 gap-3">
              {/* Provider context pill */}
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-1">
                <div className="w-5 h-5 flex-shrink-0">{selectedProvider.icon}</div>
                <span className="text-xs font-medium text-gray-600">{selectedProvider.name}</span>
              </div>

              {selectedProvider.methods.map((method) => (
                <button
                  key={method.id}
                  onClick={() => handleMethodSelect(selectedProvider, method.id)}
                  className="group flex items-center gap-4 w-full text-left p-4 rounded-xl border-2 border-gray-100 hover:border-primary-400 hover:bg-primary-50/40 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {/* Method icon */}
                  <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-gray-100 group-hover:bg-primary-100 text-gray-500 group-hover:text-primary-600 flex items-center justify-center transition-colors">
                    {method.icon}
                  </div>

                  {/* Method info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 group-hover:text-primary-700 transition-colors">
                        {method.label}
                      </span>
                      {method.badge && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200">
                          {method.badge}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {method.description}
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary-500 flex-shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end rounded-b-2xl">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
};
