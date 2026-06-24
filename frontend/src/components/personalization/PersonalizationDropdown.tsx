import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';

interface MergeTag {
  tag: string;
  label: string;
  desc: string;
}

interface PersonalizationDropdownProps {
  onInsert: (tag: string) => void;
  tags: {
    contact: MergeTag[];
    custom: MergeTag[];
    sender: MergeTag[];
    sequence: MergeTag[];
  };
  onClose: () => void;
  style?: React.CSSProperties;
  autoFocusSearch?: boolean;
}

export const PersonalizationDropdown: React.FC<PersonalizationDropdownProps> = ({
  onInsert,
  tags,
  onClose,
  style,
  autoFocusSearch = false
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    contact: true,
    custom: true,
    sender: true,
    sequence: true
  });

  const toggleSection = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

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

  // Flatten currently visible tags for keyboard navigation
  const visibleTags = useMemo(() => {
    const list: MergeTag[] = [];
    sections.forEach(sec => {
      if (openSections[sec.key]) {
        list.push(...sec.data);
      }
    });
    return list;
  }, [sections, openSections]);

  useEffect(() => {
    if (autoFocusSearch && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocusSearch]);

  // Global keydown listener for keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      
      if (visibleTags.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % visibleTags.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + visibleTags.length) % visibleTags.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onInsert(visibleTags[selectedIndex].tag);
        onClose();
      }
    };
    
    // Use capture phase to prevent editor from handling Enter
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visibleTags, selectedIndex, onClose, onInsert]);

  // Close when clicking outside
  useEffect(() => {
    let isActive = true;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    // Defer attaching to avoid catching the very same mousedown that opened the dropdown
    setTimeout(() => {
      if (isActive) document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    
    return () => {
      isActive = false;
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Render variables
  let renderIndex = 0;

  return (
    <div 
      ref={dropdownRef}
      style={style}
      // Use FIXED positioning instead of absolute to break out of overflow-hidden containers
      className="fixed z-[100] w-[280px] bg-white rounded-lg shadow-xl border border-gray-200 flex flex-col max-h-[350px] overflow-hidden"
    >
      <div className="p-2 border-b border-gray-100 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search variables..."
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setSelectedIndex(0);
            }}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
      
      <div className="overflow-y-auto p-2 space-y-3">
        {sections.map(section => {
          if (section.data.length === 0) return null;
          
          return (
            <div key={section.key}>
              <button
                type="button"
                onMouseDown={(e) => toggleSection(section.key, e)}
                className="w-full flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 px-1 hover:text-gray-700 focus:outline-none"
              >
                {section.title}
                {openSections[section.key] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              
              {openSections[section.key] && (
                <div className="space-y-0.5">
                  {section.data.map(v => {
                    const isSelected = renderIndex === selectedIndex;
                    renderIndex++;
                    return (
                      <button
                        key={v.tag}
                        type="button"
                        onMouseEnter={() => setSelectedIndex(renderIndex - 1)}
                        onMouseDown={(e) => {
                          e.preventDefault(); // Keep focus on the text editor
                          onInsert(v.tag);
                          onClose();
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded group flex flex-col focus:outline-none ${isSelected ? 'bg-indigo-50 border-indigo-100' : 'hover:bg-gray-50'}`}
                      >
                        <span className={`text-sm font-medium ${isSelected ? 'text-indigo-700' : 'text-gray-700'}`}>
                          {v.label}
                        </span>
                        <code className={`text-[10px] font-mono ${isSelected ? 'text-indigo-500' : 'text-gray-400'}`}>
                          {v.tag}
                        </code>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {visibleTags.length === 0 && (
          <div className="text-center py-4 text-xs text-gray-400">No variables found</div>
        )}
      </div>
    </div>
  );
};
