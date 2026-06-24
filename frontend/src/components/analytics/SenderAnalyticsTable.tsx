import React from 'react';
import { Mail, Activity, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import type { SenderAnalyticsResponse } from '../../types';

interface SenderAnalyticsTableProps {
  senders: SenderAnalyticsResponse[];
  isLoading: boolean;
}

export const SenderAnalyticsTable: React.FC<SenderAnalyticsTableProps> = ({ senders, isLoading }) => {
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64 bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!senders || senders.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
          <Mail className="h-6 w-6 text-gray-400" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-gray-900">No senders found</h3>
        <p className="mt-2 text-sm text-gray-500">
          Connect an email account to start tracking sender performance.
        </p>
      </div>
    );
  }

  const renderHealthBadge = (health: string) => {
    switch (health) {
      case 'excellent':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle className="w-3 h-3"/> Excellent</span>;
      case 'healthy':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><Activity className="w-3 h-3"/> Healthy</span>;
      case 'warning':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"><AlertTriangle className="w-3 h-3"/> Warning</span>;
      case 'critical':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"><XCircle className="w-3 h-3"/> Critical</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">Unknown</span>;
    }
  };

  return (
    <div className="bg-white shadow-sm ring-1 ring-gray-200 sm:rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Account</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Health</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Volume (Sent)</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Daily Limit Usage</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Open Rate</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Reply Rate</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Bounce Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {senders.map((sender) => (
              <tr key={sender.connectionId} className="hover:bg-gray-50 transition-colors">
                <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm sm:pl-6">
                  <div className="flex items-center">
                    <div>
                      <div className="font-medium text-gray-900">{sender.email}</div>
                      <div className="text-gray-500 text-xs mt-0.5">{sender.label}</div>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  {renderHealthBadge(sender.health)}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  <div className="font-medium text-gray-900">{sender.sent.toLocaleString()}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-10 text-right">{sender.dailyVolume} / {sender.dailyLimit}</span>
                    <div className="w-20 bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div 
                        className={`h-2 rounded-full ${sender.limitUsagePercent >= 90 ? 'bg-red-500' : sender.limitUsagePercent >= 75 ? 'bg-yellow-400' : 'bg-green-500'}`} 
                        style={{ width: `${Math.min(sender.limitUsagePercent, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm">
                  <div className="font-medium text-gray-900">{sender.openRate}%</div>
                  <div className="text-xs text-gray-500">{sender.opens.toLocaleString()} opens</div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm">
                  <div className="font-medium text-gray-900">{sender.replyRate}%</div>
                  <div className="text-xs text-gray-500">{sender.replies.toLocaleString()} replies</div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-sm">
                  <div className={`font-medium ${sender.bounceRate >= 5 ? 'text-red-600' : sender.bounceRate >= 2 ? 'text-yellow-600' : 'text-gray-900'}`}>
                    {sender.bounceRate}%
                  </div>
                  <div className="text-xs text-gray-500">{sender.bounces.toLocaleString()} bounces</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
