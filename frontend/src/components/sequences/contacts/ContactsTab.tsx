import React, { useEffect, useState, useCallback } from 'react';
import { Users, Pause, Play, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { EmptyState } from '../../ui/EmptyState';
import { EnrollModal } from './EnrollModal';
import { enrollmentService } from '../../../services/enrollment.service';
import type { SequenceContact, ContactEnrollmentStatus } from '../../../types';
import { toast } from 'react-hot-toast';

interface ContactsTabProps {
  sequenceId: string;
}

export const ContactsTab: React.FC<ContactsTabProps> = ({ sequenceId }) => {
  const [contacts, setContacts] = useState<SequenceContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await enrollmentService.listContacts(sequenceId);
      setContacts(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to fetch contacts');
    } finally {
      setIsLoading(false);
    }
  }, [sequenceId]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const handleStatusChange = async (contactId: string, status: 'active' | 'paused' | 'removed') => {
    try {
      await enrollmentService.patchStatus(sequenceId, contactId, status);
      toast.success(`Contact ${status}`);
      fetchContacts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || `Failed to mark contact as ${status}`);
    }
  };

  const renderStatusBadge = (status: ContactEnrollmentStatus) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      paused: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-blue-100 text-blue-800',
      replied: 'bg-purple-100 text-purple-800',
      bounced: 'bg-red-100 text-red-800',
      removed: 'bg-gray-100 text-gray-800',
      failed: 'bg-red-100 text-red-800',
      skipped: 'bg-gray-100 text-gray-600',
      unsubscribed: 'bg-gray-200 text-gray-800',
    };
    const css = colors[status] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase ${css}`}>
        {status}
      </span>
    );
  };

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner size={32} /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Enrolled Contacts</h2>
        <Button onClick={() => setIsModalOpen(true)}>Add Contacts</Button>
      </div>

      {contacts.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
          <EmptyState
            icon={Users}
            title="No contacts enrolled"
            description="Enroll contacts to start sending your sequence."
            action={<Button variant="outline" onClick={() => setIsModalOpen(true)}>Enroll your first contact</Button>}
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Step</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Next Send</th>
                  <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {contacts.map((contact) => (
                  <tr key={contact._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{contact.contact_first_name} {contact.contact_last_name}</div>
                      <div className="text-sm text-gray-500">{contact.contact_email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {renderStatusBadge(contact.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      Step {contact.current_step_index + 1} of {contact.total_steps}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {contact.next_send_at ? new Date(contact.next_send_at).toLocaleString() : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        {contact.status === 'active' && (
                          <button onClick={() => handleStatusChange(contact._id, 'paused')} className="p-2 text-gray-400 hover:text-yellow-600 rounded-lg hover:bg-yellow-50" title="Pause">
                            <Pause className="w-4 h-4" />
                          </button>
                        )}
                        {contact.status === 'paused' && (
                          <button onClick={() => handleStatusChange(contact._id, 'active')} className="p-2 text-gray-400 hover:text-green-600 rounded-lg hover:bg-green-50" title="Resume">
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {contact.status !== 'removed' && (
                          <button onClick={() => handleStatusChange(contact._id, 'removed')} className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50" title="Remove">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <EnrollModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        sequenceId={sequenceId}
        onSuccess={fetchContacts}
      />
    </div>
  );
};
