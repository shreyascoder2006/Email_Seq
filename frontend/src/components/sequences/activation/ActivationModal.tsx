import React, { useState } from 'react';
import { AlertTriangle, XCircle, CheckCircle, Mail, Users, List, Clock, Calendar } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import type { Sequence } from '../../../types';
import type { PreActivationCheckResponse } from '../../../services/sequence.service';

interface ActivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  sequence: Sequence;
  checkResult: PreActivationCheckResponse | null;
}

export const ActivationModal: React.FC<ActivationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  sequence,
  checkResult,
}) => {
  const [confirmationInput, setConfirmationInput] = useState('');

  if (!checkResult) return null;

  const { valid, errors, warnings, is_first_campaign, summary } = checkResult;
  
  // Format sending window
  const windowStr = sequence.sending_window
    ? `${sequence.sending_window.start_time} - ${sequence.sending_window.end_time}`
    : 'Any time';

  // Determine the exact required confirmation string
  let requiredConfirmation = '';
  let protectionType: 'first_campaign' | 'large_campaign' | 'none' = 'none';

  if (is_first_campaign) {
    protectionType = 'first_campaign';
    requiredConfirmation = `SEND ${summary.contacts}`;
  } else if (summary.contacts >= 500) {
    protectionType = 'large_campaign';
    requiredConfirmation = `START 500`;
  } else if (summary.contacts >= 100) {
    protectionType = 'large_campaign';
    requiredConfirmation = `START 100`;
  }

  const isConfirmed = protectionType === 'none' || confirmationInput === requiredConfirmation;
  const canLaunch = valid && isConfirmed;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Launch Sequence" maxWidth="2xl">
      <div className="space-y-6">
        
        {/* Errors (Blockers) */}
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex gap-3">
              <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-red-800">Cannot Launch Sequence</h4>
                <ul className="mt-1 space-y-1 text-sm text-red-700">
                  {errors.map((err, idx) => <li key={idx}>• {err}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-yellow-800">Review Warnings</h4>
                <ul className="mt-1 space-y-1 text-sm text-yellow-700">
                  {warnings.map((warn, idx) => <li key={idx}>• {warn}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Summary Grid */}
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
          <div>
            <div className="flex items-center text-sm font-medium text-gray-500 mb-1">
              <Mail className="h-4 w-4 mr-2" /> Sender
            </div>
            <div className="text-sm font-semibold text-gray-900 truncate">
              {summary.sender}
            </div>
          </div>
          <div>
            <div className="flex items-center text-sm font-medium text-gray-500 mb-1">
              <Users className="h-4 w-4 mr-2" /> Contacts
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {summary.contacts}
            </div>
          </div>
          <div>
            <div className="flex items-center text-sm font-medium text-gray-500 mb-1">
              <List className="h-4 w-4 mr-2" /> Steps
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {summary.steps}
            </div>
          </div>
          <div>
            <div className="flex items-center text-sm font-medium text-gray-500 mb-1">
              <Calendar className="h-4 w-4 mr-2" /> Emails Sending Today
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {summary.estimated_sends_today}
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center text-sm font-medium text-gray-500 mb-1">
              <span className="font-mono text-xs mr-2 border border-gray-300 rounded px-1">Subj</span>
              First Email Subject
            </div>
            <div className="text-sm font-semibold text-gray-900 truncate">
              {summary.first_subject}
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center text-sm font-medium text-gray-500 mb-1">
              <Clock className="h-4 w-4 mr-2" /> Sending Window
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {windowStr} <span className="text-gray-500 font-normal ml-1">({sequence.sending_window?.timezone})</span>
            </div>
          </div>
        </div>

        {/* Protection Confirmation */}
        {valid && protectionType !== 'none' && (
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-5">
            <h4 className="text-sm font-semibold text-primary-900 mb-2">
              {protectionType === 'first_campaign' ? 'First Campaign Confirmation' : 'Large Campaign Confirmation'}
            </h4>
            <p className="text-sm text-primary-700 mb-4">
              {protectionType === 'first_campaign' 
                ? 'This appears to be the first campaign sent from this account.'
                : 'You are attempting to launch a large sequence.'}
              <br />
              Please type <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-primary-300">{requiredConfirmation}</span> to continue.
            </p>
            <input
              type="text"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              className="w-full px-3 py-2 border border-primary-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono text-center"
              placeholder={requiredConfirmation}
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
          </div>
        )}

      </div>

      <div className="mt-8 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            if (canLaunch) onConfirm();
          }}
          disabled={!canLaunch}
          className={canLaunch ? 'bg-primary-600 hover:bg-primary-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
        >
          {canLaunch ? <><CheckCircle className="mr-2 h-4 w-4" /> Start Sending</> : 'Start Sending'}
        </Button>
      </div>
    </Modal>
  );
};
