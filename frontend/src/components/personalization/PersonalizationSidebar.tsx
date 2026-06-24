import React, { useState } from 'react';
import { Tag, Search, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { templateService } from '../../services/template.service';

export interface MergeTag {
  tag: string;
  label: string;
  desc: string;
}

export interface SidebarProps {
  onInsert: (tag: string) => void;
  tags: {
    contact: MergeTag[];
    custom: MergeTag[];
    sender: MergeTag[];
    sequence: MergeTag[];
  };
  onCustomFieldCreated?: () => void;
}

export const PersonalizationSidebar: React.FC<SidebarProps> = ({ onInsert, tags, onCustomFieldCreated }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    contact: true,
    custom: true,
    sender: true,
    sequence: true
  });

  // Modal state for Custom Field
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [newCustomKey, setNewCustomKey] = useState('');
  const [newCustomLabel, setNewCustomLabel] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const filterTags = (list: MergeTag[]) => {
    if (!searchTerm) return list;
    const lower = searchTerm.toLowerCase();
    return list.filter(t => t.label.toLowerCase().includes(lower) || t.tag.toLowerCase().includes(lower));
  };

  const sections = [
    { key: 'contact', title: 'Contact Fields', data: filterTags(tags.contact) },
    { key: 'custom', title: 'Custom Fields', data: filterTags(tags.custom) },
    { key: 'sender', title: 'Sender Fields', data: filterTags(tags.sender) },
    { key: 'sequence', title: 'Sequence Fields', data: filterTags(tags.sequence) },
  ];

  const handleCreateCustomField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomKey || !newCustomLabel) return;
    setIsCreating(true);
    try {
      await templateService.createCustomMergeTag({ key: newCustomKey, label: newCustomLabel });
      setShowCustomModal(false);
      setNewCustomKey('');
      setNewCustomLabel('');
      onCustomFieldCreated?.();
    } catch (err: any) {
      alert(err.response?.data?.message || err.message || 'Failed to create custom field');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="w-[300px] bg-gray-50 border-l border-gray-200 flex flex-col hidden md:flex h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-200 bg-white">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
          <Tag className="w-4 h-4 text-indigo-500" />
          Personalization Workspace
        </h3>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search Variables..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {sections.map(section => {
          if (section.data.length === 0 && searchTerm) return null;
          if (section.data.length === 0 && section.key === 'custom' && !searchTerm) {
            // We still want to show custom section so they can click the button
          }
          
          return (
            <div key={section.key}>
              <button
                type="button"
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 hover:text-gray-700 transition-colors"
              >
                {section.title}
                {openSections[section.key] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              {openSections[section.key] && (
                <div className="space-y-2">
                  {section.data.map(v => (
                    <div key={v.tag} className="bg-white border border-gray-200 rounded-lg p-2.5 flex items-center justify-between gap-2 group hover:border-indigo-300 hover:shadow-sm transition-all">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-gray-700 block truncate">{v.label}</span>
                        <code className="text-xs font-mono text-indigo-600 block truncate mt-0.5">{v.tag}</code>
                      </div>
                      <button
                        type="button"
                        onClick={() => onInsert(v.tag)}
                        className="flex-shrink-0 text-xs px-2.5 py-1.5 bg-gray-50 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 font-medium rounded border border-gray-200 hover:border-indigo-200 transition-colors"
                      >
                        Insert
                      </button>
                    </div>
                  ))}
                  
                  {section.key === 'custom' && (
                    <button 
                      onClick={() => setShowCustomModal(true)}
                      className="w-full mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-2 rounded-md border border-dashed border-indigo-200 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Create Custom Field
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showCustomModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5 animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Create Custom Field</h3>
            <form onSubmit={handleCreateCustomField} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Field Label</label>
                <input
                  autoFocus
                  type="text"
                  placeholder="e.g. Favorite Product"
                  value={newCustomLabel}
                  onChange={e => {
                    setNewCustomLabel(e.target.value);
                    if (!newCustomKey || newCustomKey === newCustomLabel.toLowerCase().replace(/[^a-z0-9_]/g, '_')) {
                      setNewCustomKey(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''));
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Internal Key</label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-gray-400 font-mono text-sm">{`{{`}</span>
                  <input
                    type="text"
                    value={newCustomKey}
                    onChange={e => setNewCustomKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    className="w-full pl-8 pr-8 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono text-indigo-600 bg-gray-50"
                    required
                  />
                  <span className="absolute right-3 text-gray-400 font-mono text-sm">{`}}`}</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Only lowercase letters, numbers, and underscores.</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50"
                >
                  {isCreating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
