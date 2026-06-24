import React from 'react';
import { X, Mail, Settings, ChevronRight } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import api from '../../services/api';

interface ProviderSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSmtp: () => void;
}

export const ProviderSelectionModal: React.FC<ProviderSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelectSmtp,
}) => {
  const handleConnectGoogle = () => {
    // Redirect to backend OAuth initiation
    window.location.href = `${api.defaults.baseURL}/oauth/google/auth`;
  };

  const handleConnectMicrosoft = () => {
    // Redirect to backend OAuth initiation
    window.location.href = `${api.defaults.baseURL}/oauth/microsoft/auth`;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" maxWidth="max-w-2xl">
      <div className="relative">
        <button
          onClick={onClose}
          className="absolute right-0 top-0 p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-8 pb-10">
          <div className="text-center mb-8">
            <div className="mx-auto w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center mb-4">
              <Mail className="w-8 h-8 text-primary-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Mailbox Setup</h2>
            <p className="text-gray-500 max-w-md mx-auto">
              Connect your account to send emails through the sequencing platform.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {/* Google Card */}
            <div className="border border-gray-200 rounded-xl p-6 hover:border-blue-400 hover:shadow-sm transition-all bg-white flex flex-col items-center text-center">
              <div className="w-12 h-12 mb-4">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Google Workspace</h3>
              <p className="text-sm text-gray-500 mb-6 flex-grow">Connect your Gmail or Google Workspace account.</p>
              <Button onClick={handleConnectGoogle} className="w-full bg-white border border-gray-300 text-gray-700 hover:bg-gray-50">
                Connect Google
              </Button>
            </div>

            {/* Microsoft Card */}
            <div className="border border-gray-200 rounded-xl p-6 hover:border-blue-500 hover:shadow-sm transition-all bg-white flex flex-col items-center text-center">
              <div className="w-12 h-12 mb-4">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" fill="#00a4ef"/>
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Microsoft Outlook</h3>
              <p className="text-sm text-gray-500 mb-6 flex-grow">Connect your Outlook or Microsoft 365 account.</p>
              <Button onClick={handleConnectMicrosoft} className="w-full bg-white border border-gray-300 text-gray-700 hover:bg-gray-50">
                Connect Microsoft
              </Button>
            </div>
          </div>

          {/* Fallback to SMTP */}
          <div className="text-center border-t border-gray-100 pt-6">
            <p className="text-sm text-gray-500 mb-3">Using another provider?</p>
            <button 
              onClick={() => {
                onClose();
                onSelectSmtp();
              }}
              className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-900 group"
            >
              <Settings className="w-4 h-4 mr-2" />
              Connect via custom SMTP/IMAP
              <ChevronRight className="w-4 h-4 ml-1 text-gray-400 group-hover:text-gray-600 transition-colors" />
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
