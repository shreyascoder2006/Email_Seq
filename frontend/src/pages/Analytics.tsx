import React from 'react';
import { BarChart2 } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';

export const Analytics: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-gray-500">View detailed performance metrics across all sequences.</p>
        <Button variant="outline">Export Data</Button>
      </div>

      <EmptyState
        icon={BarChart2}
        title="No data available"
        description="Analytics will populate here once you start sending emails and generating engagement."
      />
    </div>
  );
};
