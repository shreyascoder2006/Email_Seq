import React from 'react';
import { format } from 'date-fns';
import { Play, Pause, Trash2, Eye, Edit2 } from 'lucide-react';
import type { Sequence } from '../../types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import { Button } from '../ui/Button';

interface SequenceTableProps {
  sequences: Sequence[];
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onUpdateStatus: (id: string, status: Sequence['status']) => void;
  onDelete: (id: string) => void;
}

export const SequenceTable: React.FC<SequenceTableProps> = ({
  sequences,
  onView,
  onEdit,
  onUpdateStatus,
  onDelete,
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-blue-100 text-blue-800';
      case 'archived':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const calculateRate = (part: number, total: number) => {
    if (total === 0) return '0%';
    return `${Math.round((part / total) * 100)}%`;
  };

  return (
    <div className="rounded-md border border-gray-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created Date</TableHead>
            <TableHead className="text-right">Contacts</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="text-right">Open Rate</TableHead>
            <TableHead className="text-right">Reply Rate</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sequences.map((seq) => (
            <TableRow key={seq._id}>
              <TableCell className="font-medium">
                <div>
                  <p className="text-sm text-gray-900">{seq.name}</p>
                  {seq.description && (
                    <p className="text-xs text-gray-500 truncate max-w-[200px]">{seq.description}</p>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${getStatusColor(
                    seq.status
                  )}`}
                >
                  {seq.status}
                </span>
              </TableCell>
              <TableCell className="text-gray-500">
                {format(new Date(seq.created_at), 'MMM d, yyyy')}
              </TableCell>
              <TableCell className="text-right">{seq.stats.total_contacts}</TableCell>
              <TableCell className="text-right">{seq.stats.total_sent}</TableCell>
              <TableCell className="text-right font-medium text-green-600">
                {calculateRate(seq.stats.total_opens, seq.stats.total_sent)}
              </TableCell>
              <TableCell className="text-right font-medium text-primary-600">
                {calculateRate(seq.stats.total_replies, seq.stats.total_sent)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onView(seq._id)} title="View">
                    <Eye className="h-4 w-4 text-gray-500 hover:text-gray-900" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onEdit(seq._id)} title="Edit">
                    <Edit2 className="h-4 w-4 text-gray-500 hover:text-gray-900" />
                  </Button>
                  
                  {seq.status === 'active' ? (
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onUpdateStatus(seq._id, 'paused')} title="Pause">
                      <Pause className="h-4 w-4 text-yellow-500 hover:text-yellow-600" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onUpdateStatus(seq._id, 'active')} title="Resume" disabled={seq.status === 'completed' || seq.status === 'archived'}>
                      <Play className="h-4 w-4 text-green-500 hover:text-green-600" />
                    </Button>
                  )}

                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-red-50" onClick={() => onDelete(seq._id)} title="Delete">
                    <Trash2 className="h-4 w-4 text-red-500 hover:text-red-600" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
