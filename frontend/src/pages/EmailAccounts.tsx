import React, { useEffect, useState, useCallback } from 'react';
import { Mail, Edit2, Trash2, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { EmailAccountModal } from '../components/email/EmailAccountModal';
import { ProviderSelectionModal } from '../components/email/ProviderSelectionModal';
import type { SmtpPrefill } from '../components/email/ProviderSelectionModal';
import { emailAccountService } from '../services/emailAccount.service';
import type { EmailConnection, CreateEmailConnectionDto, UpdateEmailConnectionDto } from '../types';
import { useSearchParams } from 'react-router-dom';

export const EmailAccounts: React.FC = () => {
  const [accounts, setAccounts] = useState<EmailConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<EmailConnection | null>(null);
  const [smtpPrefill, setSmtpPrefill] = useState<SmtpPrefill | undefined>(undefined);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const fetchAccounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await emailAccountService.list();
      setAccounts(data);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to load email accounts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    const success = searchParams.get('oauth_success');
    const error = searchParams.get('oauth_error');

    if (success === 'true') {
      toast.success('Account connected successfully');
      setSearchParams({}); // Clear params
    } else if (error) {
      toast.error(`OAuth failed: ${error}`);
      setSearchParams({}); // Clear params
    }
  }, [searchParams, setSearchParams]);

  const handleOpenCreate = () => {
    setEditingAccount(null);
    setSmtpPrefill(undefined);
    setIsProviderModalOpen(true);
  };

  const handleOpenEdit = (account: EmailConnection) => {
    setEditingAccount(account);
    setSmtpPrefill(undefined);
    setIsModalOpen(true);
  };

  /** Called by ProviderSelectionModal when user picks SMTP connection */
  const handleSelectSmtp = (prefill?: SmtpPrefill) => {
    setSmtpPrefill(prefill);
    setIsProviderModalOpen(false);
    setIsModalOpen(true);
  };

  const handleSubmit = async (data: CreateEmailConnectionDto | UpdateEmailConnectionDto) => {
    try {
      if (editingAccount) {
        await emailAccountService.update(editingAccount._id, data);
        toast.success('Account updated successfully');
      } else {
        await emailAccountService.create(data as CreateEmailConnectionDto);
        toast.success('Account connected successfully');
      }
      setIsModalOpen(false);
      fetchAccounts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save account');
      throw err; // throw to keep modal open and submitting state
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this account? Sequences using it will fail to send.')) {
      return;
    }
    try {
      await emailAccountService.delete(id);
      toast.success('Account deleted');
      fetchAccounts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete account');
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    const toastId = toast.loading('Testing connection...');
    try {
      const res = await emailAccountService.testConnection(id, true);
      toast.success(res.message || 'Connection test passed!', { id: toastId });
      fetchAccounts(); // refresh to get updated status
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.message || 'Connection failed';
      toast.error(msg, { id: toastId, duration: 6000 });
      fetchAccounts(); // refresh to see 'failed' status
    } finally {
      setTestingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200"><CheckCircle2 className="w-3.5 h-3.5" /> Connected</span>;
      case 'inactive':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200"><Clock className="w-3.5 h-3.5" /> Disconnected</span>;
      case 'failed':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200"><XCircle className="w-3.5 h-3.5" /> Verification Failed</span>;
      case 'pending':
      default:
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200"><Clock className="w-3.5 h-3.5" /> Needs Verification</span>;
    }
  };

  return (
    <div className="space-y-6">
      <Toaster position="top-right" />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Email Accounts</h2>
          <p className="text-gray-500">Connect and manage your sending email accounts.</p>
        </div>
        <Button onClick={handleOpenCreate}>Connect Account</Button>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 p-4 border border-red-200">
          <p className="text-sm font-medium text-red-800">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={fetchAccounts}>Try Again</Button>
        </div>
      ) : isLoading ? (
        <div className="flex h-64 items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200">
          <LoadingSpinner size={32} />
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
          <EmptyState
            icon={Mail}
            title="No email accounts connected"
            description="Connect your Gmail, Outlook, or custom SMTP accounts to start sending."
            action={<Button variant="outline" onClick={handleOpenCreate}>Connect an account</Button>}
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SMTP Host</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Tested</th>
                  <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {accounts.map((account) => (
                  <tr key={account._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold">
                          {account.label.charAt(0).toUpperCase()}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{account.label}</div>
                          <div className="text-sm text-gray-500">{account.from_email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{account.smtp_host}</div>
                      <div className="text-xs text-gray-500">Port {account.smtp_port} • {account.smtp_encryption.toUpperCase()}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(account.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {account.last_verified_at ? new Date(account.last_verified_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => handleTestConnection(account._id)}
                          disabled={testingId === account._id}
                          className="text-gray-600 hover:text-gray-900"
                        >
                          {testingId === account._id ? <LoadingSpinner size={16} /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                          Test Connection
                        </Button>
                        <button onClick={() => handleOpenEdit(account)} className="p-2 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-primary-50 transition-colors" title="Edit Account">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(account._id)} className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors" title="Delete Account">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ProviderSelectionModal
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
        onSelectSmtp={handleSelectSmtp}
      />

      <EmailAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        initialData={editingAccount}
        prefillData={smtpPrefill}
      />
    </div>
  );
};
