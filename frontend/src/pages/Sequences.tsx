import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Search, Filter } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { SequenceTable } from '../components/sequences/SequenceTable';
import { CreateSequenceModal } from '../components/sequences/CreateSequenceModal';
import { sequenceService } from '../services/sequence.service';
import type { Sequence } from '../types';

export const Sequences: React.FC = () => {
  const navigate = useNavigate();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Pagination & Filtering
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // reset to page 1 on search
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchSequences = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await sequenceService.list({
        page,
        limit: 10,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
      });
      
      setSequences(response.data);
      setTotalPages(response.total_pages || 1);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to load sequences');
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchSequences();
  }, [fetchSequences]);

  // Actions

  const handleUpdateStatus = async (id: string, newStatus: Sequence['status']) => {
    try {
      await sequenceService.updateStatus(id, newStatus);
      setSequences((prev) =>
        prev.map((seq) => (seq._id === id ? { ...seq, status: newStatus } : seq))
      );
    } catch (err) {
      console.error('Failed to update status', err);
      alert('Failed to update status');
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sequences</h2>
          <p className="text-gray-500">Manage your automated email sequences.</p>
        </div>
        <Button id="btn-create-sequence" onClick={() => setIsCreateModalOpen(true)}>Create Sequence</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-200">
        <div className="relative w-full sm:max-w-md">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full rounded-md border-0 py-2 pl-10 pr-3 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-primary-600 sm:text-sm sm:leading-6"
            placeholder="Search sequences..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            className="block w-full rounded-md border-0 py-2 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-primary-600 sm:text-sm sm:leading-6"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
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
          <SequenceTable
            sequences={sequences}
            onView={(id) => navigate(`/sequences/${id}/builder-v2`)}
            onEdit={(id) => navigate(`/sequences/${id}/builder-v2`)}
            onUpdateStatus={handleUpdateStatus}
            onDelete={handleDelete}
          />
          
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6 rounded-xl shadow-sm">
              <div className="flex flex-1 justify-between sm:hidden">
                <Button variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <Button variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
              </div>
              <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing page <span className="font-medium">{page}</span> of{' '}
                    <span className="font-medium">{totalPages}</span>
                  </p>
                </div>
                <div>
                  <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                    <Button
                      variant="outline"
                      className="rounded-r-none"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-l-none"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Next
                    </Button>
                  </nav>
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
