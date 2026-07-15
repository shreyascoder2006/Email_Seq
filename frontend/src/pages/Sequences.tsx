import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Search, Filter, Download, Trash2, Gift } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { SequenceMetricsTable } from '../components/sequences/SequenceMetricsTable';
import { toast } from 'react-hot-toast';
import { CreateSequenceModal } from '../components/sequences/CreateSequenceModal';
import { sequenceService } from '../services/sequence.service';
import type { Sequence } from '../types';

export const Sequences: React.FC = () => {
  const navigate = useNavigate();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);

  // Pagination & Filtering
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Debounce search: fires once after user stops typing for 500ms.
  // Simple and correct — no stale-closure issues.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const [fetchTrigger, setFetchTrigger] = useState(0);
  const fetchSequences = useCallback(() => {
    setFetchTrigger(t => t + 1);
  }, []);

  // NOTE: No location.pathname watcher here.
  // React Router fully unmounts Sequences when navigating to builder/wizard/recipients
  // (they are separate top-level routes), so the component remounts cleanly on
  // navigation back and triggers a single fresh fetch via the effect below.

  useEffect(() => {
    const controller = new AbortController();

    const loadSequences = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await sequenceService.list({
          page,
          limit,
          search: debouncedSearch || undefined,
          status: statusFilter || undefined,
        }, controller.signal);
        
        if (controller.signal.aborted) return;
        
        setSequences(response.data);
        setTotalPages(response.total_pages || 1);
        setTotalItems(response.total || 0);
        setSelectedIds([]); // clear selection on fetch
      } catch (err: any) {
        if (controller.signal.aborted || err.name === 'CanceledError' || err.message === 'canceled') return; // Ignore canceled requests
        console.error('Sequences fetch failed with error:', err);
        setError(err.response?.data?.error?.message || err.message || 'Failed to load sequences');
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadSequences();

    return () => {
      controller.abort();
    };
  }, [page, limit, debouncedSearch, statusFilter, fetchTrigger]);

  // Actions

  const handleUpdateStatus = async (id: string, newStatus: Sequence['status']) => {
    // Guard: skip no-op transitions to avoid state machine errors
    const currentSeq = sequences.find(s => s._id === id);
    if (currentSeq && currentSeq.status === newStatus) return;

    try {
      if (newStatus === 'active') {
        const updated = await sequenceService.activate(id);
        setSequences((prev) =>
          prev.map((seq) => (seq._id === id ? { ...seq, status: updated.status } : seq))
        );
        toast.success('Sequence activated');
      } else {
        const updated = await sequenceService.updateStatus(id, newStatus);
        setSequences((prev) =>
          prev.map((seq) => (seq._id === id ? { ...seq, status: updated.status } : seq))
        );
        toast.success(`Sequence ${newStatus}`);
      }
    } catch (err: any) {
      console.error('Failed to update status', err);
      toast.error(err?.response?.data?.message || 'Failed to update sequence status');
      // Re-fetch to reset toggle visually if it failed
      fetchSequences();
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this sequence? This action cannot be undone.')) {
      return;
    }
    try {
      await sequenceService.delete(id);
      fetchSequences();
    } catch (err) {
      console.error('Failed to delete sequence', err);
      alert('Failed to delete sequence');
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(sequences.map((s) => s._id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [...prev, id]);
    } else {
      setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
    }
  };

  const handleExport = () => {
    toast('Export functionality coming soon!', { icon: '📥' });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} sequences?`)) {
      return;
    }

    setIsDeletingBulk(true);
    const toastId = toast.loading(`Deleting ${selectedIds.length} sequences...`);
    
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => sequenceService.delete(id))
      );

      const successful = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (failed === 0) {
        toast.success(`Successfully deleted ${successful} sequences`, { id: toastId });
      } else if (successful === 0) {
        toast.error(`Failed to delete ${failed} sequences`, { id: toastId });
      } else {
        toast.error(`Deleted ${successful} sequences, ${failed} failed`, { id: toastId });
      }

      setSelectedIds([]);
      fetchSequences();
    } catch (err) {
      toast.error('An unexpected error occurred during bulk delete', { id: toastId });
    } finally {
      setIsDeletingBulk(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Sequences</h2>
          <p className="text-sm text-gray-500 mt-1">Manage and track the performance of your outreach sequences</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="text-indigo-600 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-700 hidden sm:flex">
            <Gift className="w-4 h-4 mr-2" />
            Earn up to $1000
          </Button>
          <Button id="btn-create-sequence" className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-600/30" onClick={() => setIsCreateModalOpen(true)}>
            + New Sequence
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-center justify-between bg-white p-3 rounded-xl shadow-sm border border-gray-200">
        <div className="flex flex-1 flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
          <div className="relative w-full sm:max-w-xs">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="text"
              className="block w-full rounded-lg border-0 py-2 pl-10 pr-3 text-gray-900 ring-1 ring-inset ring-gray-200 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 bg-gray-50"
              placeholder="Search sequences..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="h-4 w-4 text-gray-400 hidden sm:block" />
            <select
              className="block w-full rounded-lg border-0 py-2 pl-3 pr-8 text-gray-700 ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-indigo-600 sm:text-sm bg-gray-50"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Filter: All</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select className="block w-full rounded-lg border-0 py-2 pl-3 pr-8 text-gray-700 ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-indigo-600 sm:text-sm bg-gray-50">
              <option>Sort by: Recently Updated</option>
              <option>Sort by: Name (A-Z)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full lg:w-auto justify-end border-t lg:border-t-0 pt-3 lg:pt-0 border-gray-100">
          <Button variant="outline" size="sm" onClick={handleExport} className="text-gray-700 border-gray-200 hover:bg-gray-50">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleBulkDelete}
            disabled={selectedIds.length === 0 || isDeletingBulk}
            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Selected
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 p-4 border border-red-200">
          <p className="text-sm font-medium text-red-800">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={fetchSequences}>
            Try Again
          </Button>
        </div>
      ) : isLoading ? (
        <div className="flex h-64 items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200">
          <LoadingSpinner size={32} />
        </div>
      ) : sequences.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
          <EmptyState
            icon={Send}
            title={debouncedSearch || statusFilter ? 'No matching sequences found' : 'No sequences found'}
            description={
              debouncedSearch || statusFilter
                ? 'Try adjusting your search or filter criteria.'
                : 'Get started by creating a new email sequence to automate your outreach.'
            }
            action={
              !debouncedSearch && !statusFilter ? (
                <Button variant="outline" onClick={() => setIsCreateModalOpen(true)}>
                  Create your first sequence
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => { setSearch(''); setStatusFilter(''); }}>
                  Clear Filters
                </Button>
              )
            }
          />
        </div>
      ) : (
        <>
          <SequenceMetricsTable
            sequences={sequences}
            selectedIds={selectedIds}
            onSelectAll={handleSelectAll}
            onSelectRow={handleSelectRow}
            onView={(id) => navigate(`/sequences/${id}/builder-v2`)}
            onEdit={(id) => navigate(`/sequences/${id}/builder-v2`)}
            onUpdateStatus={handleUpdateStatus}
            onDelete={handleDelete}
          />
          
          {totalPages > 0 && (
            <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6 rounded-xl shadow-sm">
              <div className="flex flex-1 justify-between sm:hidden">
                <Button variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <Button variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
              </div>
              <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-500">
                    Showing <span className="font-medium text-gray-900">{totalItems === 0 ? 0 : (page - 1) * limit + 1}</span> to <span className="font-medium text-gray-900">{Math.min(page * limit, totalItems)}</span> of{' '}
                    <span className="font-medium text-gray-900">{totalItems}</span> results
                  </p>
                </div>
                <div className="flex items-center gap-6">
                  <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                    <Button
                      variant="outline"
                      className="rounded-r-none h-8 px-3 text-sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Previous
                    </Button>
                    <div className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 focus:z-20 focus:outline-offset-0 bg-white">
                      {page}
                    </div>
                    <Button
                      variant="outline"
                      className="rounded-l-none h-8 px-3 text-sm"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Next
                    </Button>
                  </nav>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Rows per page:</span>
                    <select
                      value={limit}
                      onChange={(e) => {
                        setLimit(Number(e.target.value));
                        setPage(1);
                      }}
                      className="block rounded-md border-0 py-1.5 pl-3 pr-8 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <CreateSequenceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
};
