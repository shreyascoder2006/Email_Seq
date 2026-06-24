import React, { useState, useEffect } from 'react';
import { X, ExternalLink, Check, Settings } from 'lucide-react';
import { Editor } from '@tiptap/react';

interface InsertLinkModalProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function InsertLinkModal({ editor, isOpen, onClose }: InsertLinkModalProps) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('_self');

  useEffect(() => {
    if (isOpen) {
      const previousUrl = editor.getAttributes('link').href || '';
      const previousTarget = editor.getAttributes('link').target || '_self';
      
      const { state } = editor;
      const { from, to } = state.selection;
      const selectedText = state.doc.textBetween(from, to, ' ');

      setUrl(previousUrl);
      setText(selectedText || previousUrl || '');
      setTarget(previousTarget);
      setTitle(''); // TipTap Link doesn't natively store title without custom extension, keep it simple
    }
  }, [isOpen, editor]);

  if (!isOpen) return null;

  const handleInsert = () => {
    if (!url) return;

    let finalUrl = url;
    if (!/^https?:\/\//i.test(finalUrl) && !/^mailto:/i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    const htmlLink = `<a href="${finalUrl}" target="${target === '_blank' ? '_blank' : '_self'}" ${title ? `title="${title}"` : ''}>${text || finalUrl}</a>`;

    editor.chain().focus()
      .extendMarkRange('link')
      .insertContent(htmlLink)
      .run();

    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Insert Link</h2>
            <p className="text-sm font-medium text-gray-500 mt-0.5">
              Add a link to your message.
            </p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2-Column Body */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* Left Panel - Info */}
          <div className="w-[340px] bg-[#FAF9FB] border-r border-gray-100 p-8 flex flex-col">
            <h3 className="text-[15px] font-bold text-gray-900 mb-4">Preview</h3>
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
              <a href={url || '#'} className="text-[#533EEC] font-semibold flex items-center gap-1.5 hover:underline truncate" target="_blank" rel="noreferrer" onClick={e => e.preventDefault()}>
                {text || url || 'Link text will appear here'} <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <p className="text-[13px] text-gray-500 mb-8 leading-relaxed">
              This is how your link will appear in the message.
            </p>

            <div className="bg-white rounded-xl border border-gray-200 p-5 flex-1">
              <h4 className="text-[14px] font-bold text-gray-900 mb-4 flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-indigo-50 flex items-center justify-center">
                  <span className="text-indigo-600 text-sm font-bold">💡</span>
                </div>
                Tips for better links
              </h4>
              <ul className="space-y-3">
                <li className="flex items-start gap-2.5 text-[13px] text-gray-600 font-medium">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Use clear and concise text
                </li>
                <li className="flex items-start gap-2.5 text-[13px] text-gray-600 font-medium">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Make it relevant to your message
                </li>
                <li className="flex items-start gap-2.5 text-[13px] text-gray-600 font-medium">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Avoid generic text like "click here"
                </li>
                <li className="flex items-start gap-2.5 text-[13px] text-gray-600 font-medium">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> Add a title for better accessibility
                </li>
              </ul>
            </div>
          </div>

          {/* Right Panel - Form */}
          <div className="flex-1 p-8 overflow-y-auto space-y-6">
            
            {/* URL */}
            <div>
              <label className="block text-[14px] font-bold text-gray-900 mb-1.5">
                URL <span className="text-red-500">*</span>
              </label>
              <input 
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://www.example.com"
                className="w-full h-11 px-4 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow placeholder:text-gray-400 font-medium text-gray-900"
              />
              <p className="text-[12px] text-gray-500 mt-2 font-medium">Enter the complete URL including https://</p>
            </div>

            {/* Text to display */}
            <div>
              <label className="block text-[14px] font-bold text-gray-900 mb-1.5">
                Text to display <span className="text-red-500">*</span>
              </label>
              <input 
                type="text"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Example Website"
                className="w-full h-11 px-4 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow placeholder:text-gray-400 font-medium text-gray-900"
              />
              <p className="text-[12px] text-gray-500 mt-2 font-medium">This is the clickable text that will appear in your message.</p>
            </div>

            {/* Title */}
            <div>
              <label className="block text-[14px] font-bold text-gray-900 mb-1.5">
                Title (optional)
              </label>
              <input 
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Example Website - Digital Solutions"
                className="w-full h-11 px-4 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow placeholder:text-gray-400 font-medium text-gray-900"
              />
              <p className="text-[12px] text-gray-500 mt-2 font-medium">Shows additional information on hover (recommended for accessibility).</p>
            </div>

            {/* Target */}
            <div>
              <label className="block text-[14px] font-bold text-gray-900 mb-1.5">
                Open link in...
              </label>
              <select 
                value={target}
                onChange={e => setTarget(e.target.value)}
                className="w-full h-11 px-4 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow font-medium text-gray-900 bg-white"
              >
                <option value="_self">Current window</option>
                <option value="_blank">New window / tab</option>
              </select>
              <p className="text-[12px] text-gray-500 mt-2 font-medium">Choose how the link should open when clicked.</p>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-gray-100 flex items-center justify-between bg-white">
          <button className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-bold transition-colors">
            <Settings className="w-4 h-4" /> Advanced Options
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-6 py-2.5 rounded-lg border border-gray-200 text-gray-700 text-[14px] font-bold hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button 
              onClick={handleInsert}
              disabled={!url || !text}
              className="px-6 py-2.5 rounded-lg bg-[#533EEC] text-white text-[14px] font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              Insert Link
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
