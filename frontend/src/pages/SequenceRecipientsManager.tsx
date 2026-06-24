import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Filter, MoreHorizontal, Mail, Pause, Play, Trash2, ChevronDown, Tag, Calendar, Download, ListPlus, FastForward
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { sequenceService } from '../services/sequence.service';
import { enrollmentService } from '../services/enrollment.service';
import { emailAccountService } from '../services/emailAccount.service';
import type { Sequence, SequenceContact, EmailConnection } from '../types';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../components/ui/Tooltip';
import { WizardHeader, SequenceSummary } from './SequenceBuilderWizard';
import { format } from 'date-fns';

export function SequenceRecipientsManager() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [contacts, setContacts] = useState<SequenceContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      const [seqData, accData, contactsData] = await Promise.all([
        sequenceService.getWithSteps(id),
        emailAccountService.list(),
        enrollmentService.listContacts(id, { limit: 100 })
      ]);
      setSequence(seqData.sequence);
      setConnections(accData);
      setContacts(contactsData.data);
    } catch {
      toast.error('Failed to load recipients');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  if (!sequence) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-3">
        <p className="text-gray-500 text-sm">Sequence not found.</p>
        <button
          onClick={() => navigate('/sequences')}
          className="text-indigo-600 text-sm font-medium hover:underline"
        >
          ← Back to Sequences
        </button>
      </div>
    );
  }

  const senderEmail = (() => {
    const active = connections.find(c => c.status === 'active');
    return active?.from_email ?? connections[0]?.from_email ?? '';
  })();

  const toggleSelectAll = () => {
    if (selectedIds.size === contacts.length && contacts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map(c => c._id)));
    }
  };

  const toggleSelect = (contactId: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(contactId)) newSet.delete(contactId);
    else newSet.add(contactId);
    setSelectedIds(newSet);
  };

  const handleNext = () => {
    navigate(`/sequences/${sequence._id}/preview-test`);
  };

  const handleBack = () => {
    navigate(`/sequences/${sequence._id}/recipients`);
  };

  const handleBulkDelete = async () => {
    if (!sequence) return;
    const confirm = window.confirm(`Are you sure you want to remove ${selectedIds.size} contacts?`);
    if (!confirm) return;

    try {
      await enrollmentService.bulkDelete(sequence._id, Array.from(selectedIds));
      toast.success(`Removed ${selectedIds.size} contacts`);
      setSelectedIds(new Set());
      fetchData();
    } catch (err) {
      toast.error('Failed to remove contacts');
    }
  };

  const handleBulkPause = async () => {
    if (!sequence) return;
    try {
      await enrollmentService.bulkPause(sequence._id, Array.from(selectedIds));
      toast.success(`Paused ${selectedIds.size} contacts`);
      setSelectedIds(new Set());
      fetchData();
    } catch (err) {
      toast.error('Failed to pause contacts');
    }
  };

  const handleBulkResume = async () => {
    if (!sequence) return;
    try {
      await enrollmentService.bulkResume(sequence._id, Array.from(selectedIds));
      toast.success(`Resumed ${selectedIds.size} contacts`);
      setSelectedIds(new Set());
      fetchData();
    } catch (err) {
      toast.error('Failed to resume contacts');
    }
  };

  const handleComingSoon = () => {
    toast('Coming Soon', { icon: '🚧' });
  };

  const hasSelection = selectedIds.size > 0;

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex flex-col p-6">
      <Toaster position="top-right" />

      {/* Header Container */}
      <div className="max-w-[1600px] w-full mx-auto">
        <WizardHeader
          sequence={sequence}
          stepCount={sequence.step_count || 1}
          senderEmail={senderEmail}
          onBack={() => navigate('/sequences')}
          activeStepIdx={2} // Recipients is active
        />
      </div>

      {/* Body Layout */}
      <div className="flex flex-1 max-w-[1600px] w-full mx-auto gap-6 pb-16">
        
        {/* Main Content (Left) */}
        <div style={{ flex: '0 0 80%' }} className="flex flex-col gap-4 min-w-0">
          
          {/* Header & Bulk Actions */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-bold text-gray-900">
                Total Recipients: <span className="text-indigo-600">{contacts.length}</span>
              </h2>
            </div>

            <TooltipProvider>
              <div className="flex items-center gap-2">
                {!hasSelection ? (
                  // Default Toolbar
                  <>
                    <button className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                      <Filter className="w-4 h-4" /> Filter
                    </button>
                    <button className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                      Import From <ChevronDown className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  // Bulk Actions Toolbar
                  <div className="flex items-center">
                    <div className="flex items-center mr-4">
                      <span className="text-sm font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded">
                        {selectedIds.size} Selected ▼
                      </span>
                      <span className="text-xs text-gray-500 ml-3 hidden md:inline">
                        Showing 1-{selectedIds.size} of {selectedIds.size} selected recipients
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger>
                          <button onClick={handleBulkDelete} className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Remove selected contacts</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger>
                          <button onClick={handleBulkPause} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent hover:border-indigo-100">
                            <Pause className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Pause selected contacts</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger>
                          <button onClick={handleBulkResume} className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors border border-transparent hover:border-green-100">
                            <Play className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Resume selected contacts</TooltipContent>
                      </Tooltip>

                      <div className="w-px h-6 bg-gray-200 mx-1 hidden sm:block" />

                      <Tooltip>
                        <TooltipTrigger>
                          <button onClick={handleComingSoon} className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors hidden sm:block">
                            <Tag className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Update Status</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger>
                          <button onClick={handleComingSoon} className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors hidden md:block">
                            <Calendar className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Reschedule selected contacts</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger>
                          <button onClick={handleComingSoon} className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors hidden md:block">
                            <Download className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Export selected contacts</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger>
                          <button onClick={handleComingSoon} className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors hidden lg:block">
                            <ListPlus className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Add to List</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger>
                          <button onClick={handleComingSoon} className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors hidden lg:block">
                            <FastForward className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Skip current step</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger>
                          <button onClick={handleComingSoon} className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors hidden lg:block">
                            <Mail className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Send Quick Email</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger>
                          <button className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors block lg:hidden">
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>More Actions</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                )}
              </div>
            </TooltipProvider>
          </div>

          {/* Contact Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex-1 flex flex-col">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
                  <tr>
                    <th className="p-4 w-10">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.size === contacts.length && contacts.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    <th className="p-4">Name</th>
                    <th className="p-4">Company</th>
                    <th className="p-4">Job Title</th>
                    <th className="p-4">Sequence Status</th>
                    <th className="p-4">Prospecting Status</th>
                    <th className="p-4">Next Touch</th>
                    <th className="p-4">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contacts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-12 text-center text-gray-500">
                        No recipients added yet.
                      </td>
                    </tr>
                  ) : (
                    contacts.map(contact => (
                      <tr key={contact._id} className="hover:bg-gray-50 transition-colors">
                        <td className="p-4">
                          <input 
                            type="checkbox" 
                            checked={selectedIds.has(contact._id)}
                            onChange={() => toggleSelect(contact._id)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="p-4 font-semibold text-gray-900">
                          {contact.contact_first_name} {contact.contact_last_name}
                        </td>
                        <td className="p-4 text-gray-600">{contact.contact_company || '—'}</td>
                        <td className="p-4 text-gray-600">—</td>
                        <td className="p-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            contact.status === 'active' ? 'bg-green-100 text-green-800' :
                            contact.status === 'paused' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {contact.status}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">New</span>
                        </td>
                        <td className="p-4 text-gray-600">
                          {contact.next_send_at ? format(new Date(contact.next_send_at), 'MMM d, h:mm a') : '—'}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <button className="text-gray-400 hover:text-indigo-600" title="Quick Email"><Mail className="w-4 h-4" /></button>
                            <span className="text-gray-600">{contact.contact_email}</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="p-4 border-t border-gray-200 bg-white flex items-center justify-between text-sm text-gray-500 mt-auto">
              <div>Showing {contacts.length} rows</div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1 border border-gray-200 rounded hover:bg-gray-50" disabled>Previous</button>
                <button className="px-3 py-1 border border-gray-200 rounded hover:bg-gray-50" disabled>Next</button>
              </div>
            </div>
          </div>

        </div>

        {/* Sequence Summary (Right - 20%) */}
        <div style={{ flex: '0 0 20%' }} className="shrink-0">
          <SequenceSummary sequence={sequence} />
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-30">
        <div className="max-w-[1600px] mx-auto flex justify-between items-center px-6">
          <button 
            onClick={handleBack}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          
          <button 
            onClick={handleNext}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
