import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Filter, Mail, Pause, Play, Trash2, ChevronDown, Tag, Calendar, Download, ListPlus, FastForward
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { sequenceService } from '../services/sequence.service';
import { enrollmentService } from '../services/enrollment.service';
import type { Sequence, SequenceContact } from '../types';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../components/ui/Tooltip';
import { WizardHeader } from './SequenceBuilderWizard';
import { Info } from 'lucide-react';

export function SequenceRecipientsManager() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sequence, setSequence] = useState<Sequence | null>(null);

  const [contacts, setContacts] = useState<SequenceContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      const [seqData, contactsData] = await Promise.all([
        sequenceService.getWithSteps(id),
        enrollmentService.listContacts(id, { limit: 100 })
      ]);
      setSequence(seqData.sequence);
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



  const handleBulkDelete = async () => {
    if (!sequence) return;
    if (selectedIds.size === 0) { toast('No contacts selected', { icon: 'ℹ️' }); return; }
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
    if (selectedIds.size === 0) { toast('No contacts selected', { icon: 'ℹ️' }); return; }
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
    if (selectedIds.size === 0) { toast('No contacts selected', { icon: 'ℹ️' }); return; }
    try {
      await enrollmentService.bulkResume(sequence._id, Array.from(selectedIds));
      toast.success(`Resumed ${selectedIds.size} contacts`);
      setSelectedIds(new Set());
      fetchData();
    } catch (err) {
      toast.error('Failed to resume contacts');
    }
  };

  const handleBulkSkip = async () => {
    if (!sequence) return;
    if (selectedIds.size === 0) { toast('No contacts selected', { icon: 'ℹ️' }); return; }
    try {
      await enrollmentService.bulkSkip(sequence._id, Array.from(selectedIds));
      toast.success(`Skipped ${selectedIds.size} contacts`);
      setSelectedIds(new Set());
      fetchData();
    } catch (err) {
      toast.error('Failed to skip contacts');
    }
  };

  const handleComingSoon = () => {
    toast('Coming Soon', { icon: '🚧' });
  };

  const handleToggleStatus = async (isActive: boolean) => {
    if (!sequence) return;
    try {
      if (isActive) {
        const updated = await sequenceService.activate(sequence._id);
        setSequence(updated);
        toast.success('Campaign activated');
      } else {
        const updated = await sequenceService.updateStatus(sequence._id, 'paused');
        setSequence(updated);
        toast.success('Campaign paused');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to update campaign status');
    }
  };

  const hasSelection = selectedIds.size > 0;

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex flex-col p-6">
      <Toaster position="top-right" />

      {/* Header Container */}
      <div className="w-full">
        <WizardHeader
          sequence={sequence}
          onBack={() => navigate('/sequences')}
          onNext={handleNext}
          currentStepId="recipients"
          onToggleStatus={handleToggleStatus}
        />
      </div>

      {/* Body Layout */}
      <div className="flex flex-1 w-full mx-auto pb-20 pt-6 px-6">
        
        {/* Main Content (Full Width) */}
        <div className="flex flex-col gap-5 w-full min-w-0 max-w-[1800px] mx-auto">
          
          {/* Header & Bulk Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[15px] font-bold text-gray-900">
                Total Recipients: {contacts.length}
              </h2>
              <button className="text-gray-400 hover:text-gray-600 transition-colors rounded-full p-0.5 mt-px">
                <Info className="w-[14px] h-[14px]" />
              </button>
            </div>

            <TooltipProvider>
              <div className="flex items-center gap-3">
                
                {/* Icon Buttons Group */}
                <div className="flex items-center gap-2.5 mr-4">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleBulkDelete} className="w-10 h-10 flex items-center justify-center rounded-[10px] border border-gray-200 bg-white hover:bg-gray-50 hover:border-indigo-200 transition-colors shadow-sm group">
                        <Trash2 className="w-[18px] h-[18px] text-indigo-600 group-hover:text-indigo-700" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#1C2030] text-white text-[11px] font-medium border-none py-2 px-3 rounded-md">
                      Remove selected contacts from current sequence
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleBulkPause} className="w-10 h-10 flex items-center justify-center rounded-[10px] border border-gray-200 bg-white hover:bg-gray-50 hover:border-indigo-200 transition-colors shadow-sm group">
                        <Pause className="w-[18px] h-[18px] text-indigo-600 group-hover:text-indigo-700" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#1C2030] text-white text-[11px] font-medium border-none py-2 px-3 rounded-md">
                      Pause selected contacts from current sequence
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleBulkResume} className="w-10 h-10 flex items-center justify-center rounded-[10px] border border-gray-200 bg-white hover:bg-gray-50 hover:border-indigo-200 transition-colors shadow-sm group">
                        <Play className="w-[18px] h-[18px] text-indigo-600 group-hover:text-indigo-700" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#1C2030] text-white text-[11px] font-medium border-none py-2 px-3 rounded-md">
                      Resume selected contacts from current sequence
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleComingSoon} className="w-10 h-10 flex items-center justify-center rounded-[10px] border border-gray-200 bg-white hover:bg-gray-50 hover:border-indigo-200 transition-colors shadow-sm group">
                        <Tag className="w-[18px] h-[18px] text-indigo-600 group-hover:text-indigo-700" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#1C2030] text-white text-[11px] font-medium border-none py-2 px-3 rounded-md">
                      Update prospect status
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleComingSoon} className="w-10 h-10 flex items-center justify-center rounded-[10px] border border-gray-200 bg-white hover:bg-gray-50 hover:border-indigo-200 transition-colors shadow-sm group">
                        <Calendar className="w-[18px] h-[18px] text-indigo-600 group-hover:text-indigo-700" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#1C2030] text-white text-[11px] font-medium border-none py-2 px-3 rounded-md">
                      Reschedule current campaign
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleComingSoon} className="w-10 h-10 flex items-center justify-center rounded-[10px] border border-gray-200 bg-white hover:bg-gray-50 hover:border-indigo-200 transition-colors shadow-sm group">
                        <Download className="w-[18px] h-[18px] text-indigo-600 group-hover:text-indigo-700" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#1C2030] text-white text-[11px] font-medium border-none py-2 px-3 rounded-md">
                      Export selected contacts
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleComingSoon} className="w-10 h-10 flex items-center justify-center rounded-[10px] border border-gray-200 bg-white hover:bg-gray-50 hover:border-indigo-200 transition-colors shadow-sm group">
                        <ListPlus className="w-[18px] h-[18px] text-indigo-600 group-hover:text-indigo-700" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#1C2030] text-white text-[11px] font-medium border-none py-2 px-3 rounded-md">
                      Add to list / sequence
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleBulkSkip} className="w-10 h-10 flex items-center justify-center rounded-[10px] border border-gray-200 bg-white hover:bg-gray-50 hover:border-indigo-200 transition-colors shadow-sm group">
                        <FastForward className="w-[18px] h-[18px] text-indigo-600 group-hover:text-indigo-700" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#1C2030] text-white text-[11px] font-medium border-none py-2 px-3 rounded-md">
                      Skip selected contacts
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={handleComingSoon} className="w-10 h-10 flex items-center justify-center rounded-[10px] border border-gray-200 bg-white hover:bg-gray-50 hover:border-indigo-200 transition-colors shadow-sm group">
                        <Mail className="w-[18px] h-[18px] text-indigo-600 group-hover:text-indigo-700" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#1C2030] text-white text-[11px] font-medium border-none py-2 px-3 rounded-md">
                      Send quick email
                    </TooltipContent>
                  </Tooltip>
                </div>

                {/* Filter & Import Buttons */}
                <div className="flex items-center gap-3">
                  <button className="flex items-center gap-2 h-10 px-4 border border-gray-200 bg-white rounded-lg text-[13px] font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm">
                    <Filter className="w-4 h-4 text-gray-500" /> Filter
                  </button>
                  <button className="flex items-center gap-2 h-10 px-4 border border-indigo-200 bg-white rounded-lg text-[13px] font-bold text-indigo-700 hover:bg-indigo-50 transition-colors shadow-sm">
                    Import From <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </TooltipProvider>
          </div>

          {/* Selection Bar */}
          {hasSelection && (
            <div className="flex items-center gap-4 py-3 px-2">
              <input 
                type="checkbox" 
                checked={selectedIds.size === contacts.length && contacts.length > 0}
                onChange={toggleSelectAll}
                className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 bg-indigo-600 border-transparent"
              />
              <button className="flex items-center gap-2 border border-gray-200 rounded-full px-3 py-1.5 text-[13px] font-bold text-gray-900 bg-white shadow-sm">
                {selectedIds.size} Selected <ChevronDown className="w-4 h-4 text-gray-500" />
              </button>
              <span className="text-[13px] text-gray-500">
                Showing 1-{selectedIds.size} of {selectedIds.size} selected recipients
              </span>
            </div>
          )}

          {/* Contact Table */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-white border-b border-gray-100 text-gray-900 font-bold text-[13px]">
                  <tr>
                    <th className="p-4 w-12 text-center">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.size === contacts.length && contacts.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                    </th>
                    <th className="p-4">Name</th>
                    <th className="p-4 text-center">Send Quick Email</th>
                    <th className="p-4">Company</th>
                    <th className="p-4">Job Title</th>
                    <th className="p-4">Sequence Status</th>
                    <th className="p-4">Prospecting Status</th>
                    <th className="p-4 flex items-center gap-1">Next Touch <Info className="w-3 h-3 text-gray-400" /></th>
                    <th className="p-4">Contact Phone</th>
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
                      <tr key={contact._id} className="hover:bg-gray-50 transition-colors group">
                        <td className="p-4 text-center">
                          <input 
                            type="checkbox" 
                            checked={selectedIds.has(contact._id)}
                            onChange={() => toggleSelect(contact._id)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                          />
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                              {((contact.contact_first_name?.[0] ?? '') + (contact.contact_last_name?.[0] ?? '')).toUpperCase() || '?'}
                            </div>
                            <div>
                              <div className="font-bold text-[13px] text-gray-900 leading-tight">
                                {contact.contact_first_name} {contact.contact_last_name}
                              </div>
                              <div className="text-[11px] text-gray-500 leading-tight mt-0.5 truncate max-w-[140px]">
                                {contact.custom_variables?.job_title || '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <button className="text-gray-400 hover:text-indigo-600 mx-auto block transition-colors">
                            <Mail className="w-4 h-4" />
                          </button>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-gray-100 rounded-md flex items-center justify-center shrink-0">
                              <span className="text-[10px] font-bold text-gray-500">{contact.contact_company?.[0]?.toUpperCase() || '?'}</span>
                            </div>
                            <span className="font-semibold text-gray-900 text-[13px]">{contact.contact_company || '—'}</span>
                          </div>
                        </td>
                        <td className="p-4 text-gray-600 text-[13px] truncate max-w-[150px]">
                          {contact.custom_variables?.job_title || '—'}
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            contact.status === 'active' ? 'bg-emerald-50 text-emerald-600' :
                            contact.status === 'paused' ? 'bg-orange-50 text-orange-600' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              contact.status === 'active' ? 'bg-emerald-500' :
                              contact.status === 'paused' ? 'bg-orange-500' :
                              'bg-gray-400'
                            }`} />
                            <span className="capitalize">{contact.status}</span>
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md">Cold</span>
                        </td>
                        <td className="p-4">
                          <span className="text-[13px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer">
                            {contact.next_send_at ? 'Follow-up' : 'Cold Email'}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-1.5 text-gray-500 text-[13px]">
                            <span className="text-emerald-500">📱</span> **** *** ****
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-1.5 text-gray-500 text-[13px]">
                            <Mail className="w-[14px] h-[14px]" />
                            {contact.contact_email}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="p-6 bg-white flex items-center justify-between text-[13px] text-gray-500 mt-auto">
              <div>Showing 1-{contacts.length} of {contacts.length} selected recipients</div>
              
              <div className="flex items-center gap-2">
                <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors" disabled>
                  <ChevronDown className="w-4 h-4 rotate-90" />
                </button>
                <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-indigo-600 text-indigo-600 font-bold bg-white shadow-sm">
                  1
                </button>
                <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors" disabled>
                  <ChevronDown className="w-4 h-4 -rotate-90" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span>Rows per page:</span>
                <button className="flex items-center gap-1 font-bold text-gray-900">
                  25 <ChevronDown className="w-3 h-3 text-gray-500" />
                </button>
              </div>
            </div>
          </div>

        </div>


      </div>

    </div>
  );
}
