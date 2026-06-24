import React, { useState, useRef } from 'react';
import { X, UploadCloud, Search, MoreVertical, Image as ImageIcon, Building2, PenTool, Layout, Layers, Info } from 'lucide-react';
import { Editor } from '@tiptap/react';

interface InsertImageModalProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

// Mock Image Library
const MOCK_IMAGES = [
  { id: '1', url: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&q=80', name: 'Insert Logo', size: '45 KB', date: '18 Jun 2026', type: 'PNG' },
  { id: '2', url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=800&q=80', name: 'Insert Banner', size: '120 KB', date: '17 Jun 2026', type: 'PNG' },
  { id: '3', url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80', name: 'Product Screenshot', size: '210 KB', date: '16 Jun 2026', type: 'PNG' },
  { id: '4', url: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=800&q=80', name: 'Founder Photo', size: '85 KB', date: '15 Jun 2026', type: 'JPG' },
  { id: '5', url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80', name: 'Case Study Chart', size: '98 KB', date: '14 Jun 2026', type: 'PNG' },
  { id: '6', url: 'https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=800&q=80', name: 'Email Signature', size: '32 KB', date: '13 Jun 2026', type: 'PNG' },
  { id: '7', url: 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&q=80', name: 'Product Features', size: '110 KB', date: '12 Jun 2026', type: 'PNG' },
  { id: '8', url: 'https://images.unsplash.com/photo-1506744626753-dba37c25a56e?w=800&q=80', name: 'Landscape Banner', size: '160 KB', date: '11 Jun 2026', type: 'JPG' },
];

export function InsertImageModal({ editor, isOpen, onClose }: InsertImageModalProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('my-images');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleInsert = (urlToInsert: string) => {
    editor.chain().focus().setImage({ src: urlToInsert }).run();
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          handleInsert(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1200px] h-[85vh] max-h-[900px] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-8 py-5 border-b border-gray-100 flex items-start justify-between shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Insert Image</h2>
            <p className="text-sm font-medium text-gray-500 mt-0.5">
              Choose an image from your library or upload a new one.
            </p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2-Column Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          
          {/* Left Sidebar */}
          <div className="w-[260px] bg-[#FAF9FB] border-r border-gray-100 flex flex-col p-4 shrink-0 overflow-y-auto">
            
            <button 
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-[14px] font-bold w-full transition-colors mb-2 ${activeTab === 'upload' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}
              onClick={() => setActiveTab('upload')}
            >
              <UploadCloud className="w-5 h-5" /> Upload Image
            </button>

            <button 
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-[14px] font-bold w-full transition-colors mb-6 ${activeTab === 'my-images' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}
              onClick={() => setActiveTab('my-images')}
            >
              <ImageIcon className="w-5 h-5" /> My Images
            </button>

            <div className="mb-2 px-4 flex items-center gap-2 text-gray-900 font-bold text-[14px]">
              Saved Assets <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
            </div>
            <div className="space-y-1 mb-8">
              <button className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] font-medium text-gray-600 hover:bg-gray-100 w-full transition-colors">
                <Building2 className="w-4 h-4 text-gray-400" /> Company Logos
              </button>
              <button className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] font-medium text-gray-600 hover:bg-gray-100 w-full transition-colors">
                <PenTool className="w-4 h-4 text-gray-400" /> Signature Images
              </button>
              <button className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] font-medium text-gray-600 hover:bg-gray-100 w-full transition-colors">
                <Layout className="w-4 h-4 text-gray-400" /> Product Screenshots
              </button>
              <button className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] font-medium text-gray-600 hover:bg-gray-100 w-full transition-colors">
                <ImageIcon className="w-4 h-4 text-gray-400" /> Marketing Banners
              </button>
              <button className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] font-medium text-gray-600 hover:bg-gray-100 w-full transition-colors">
                <Layers className="w-4 h-4 text-gray-400" /> Other Assets
              </button>
            </div>

            <div className="mt-auto bg-indigo-50/50 border border-indigo-100 rounded-xl p-4">
              <div className="flex items-center gap-2 text-indigo-700 font-bold text-[13px] mb-1.5">
                <span className="text-base">💡</span> Tip
              </div>
              <p className="text-[12px] text-gray-600 font-medium leading-snug">
                <strong className="text-gray-900">Upload once, use anywhere.</strong><br/>
                Your images are saved and reusable across emails.
              </p>
            </div>
          </div>

          {/* Right Main Content */}
          <div className="flex-1 overflow-y-auto bg-white p-8 flex flex-col">
            
            {/* Upload Area */}
            <h3 className="text-[15px] font-bold text-gray-900 mb-3">Upload Image</h3>
            <div className="border-2 border-dashed border-indigo-200 bg-[#F8F9FE] rounded-2xl flex flex-col items-center justify-center py-10 px-6 mb-10 transition-colors hover:bg-indigo-50 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              <input type="file" className="hidden" ref={fileInputRef} accept="image/*" onChange={handleFileUpload} />
              <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mb-4">
                <UploadCloud className="w-6 h-6 text-indigo-600" />
              </div>
              <p className="text-[15px] font-bold text-gray-900 mb-2">Drag and drop image here</p>
              <p className="text-[13px] text-gray-500 font-medium mb-4">or</p>
              <button className="px-5 py-2 rounded-lg border border-indigo-200 text-indigo-600 text-[13px] font-bold hover:bg-indigo-50 transition-colors shadow-sm mb-4 bg-white">
                Browse Files
              </button>
              <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">
                PNG, JPG, JPEG, WEBP, GIF • Max size: 5MB
              </p>
            </div>

            {/* My Images Toolbar */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <h3 className="text-[15px] font-bold text-gray-900">My Images</h3>
                <span className="px-2.5 py-0.5 bg-gray-100 text-gray-600 text-[12px] font-bold rounded-full">
                  {MOCK_IMAGES.length}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search images..." 
                    className="h-10 pl-9 pr-4 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500 w-[200px] font-medium"
                  />
                </div>
                <select className="h-10 px-3 rounded-lg border border-gray-200 text-[13px] font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option>Sort by: Newest</option>
                  <option>Sort by: Oldest</option>
                  <option>Sort by: Name</option>
                </select>
              </div>
            </div>

            {/* Image Grid */}
            <div className="grid grid-cols-4 gap-5 pb-6">
              {MOCK_IMAGES.map((img) => (
                <div 
                  key={img.id} 
                  className={`border rounded-xl bg-white overflow-hidden flex flex-col transition-all hover:shadow-md ${selectedImage === img.url ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-200'}`}
                  onClick={() => setSelectedImage(img.url)}
                >
                  <div className="aspect-[4/3] bg-gray-50 border-b border-gray-100 flex items-center justify-center p-3 relative group">
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover rounded shadow-sm" />
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleInsert(img.url); }}
                        className="px-4 py-2 bg-white rounded-lg text-[13px] font-bold text-gray-900 shadow-sm hover:scale-105 transition-transform"
                      >
                        Select
                      </button>
                    </div>
                  </div>
                  <div className="p-3">
                    <h4 className="text-[13px] font-bold text-gray-900 truncate mb-1" title={img.name}>{img.name}</h4>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">
                      {img.type} • {img.size} • {img.date}
                    </p>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleInsert(img.url); }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-indigo-600 hover:bg-indigo-50 text-[13px] font-bold transition-colors"
                      >
                        <UploadCloud className="w-4 h-4 rotate-180" /> Insert
                      </button>
                      <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-md transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-gray-100 flex items-center justify-end gap-3 bg-white shrink-0">
          <button onClick={onClose} className="px-6 py-2.5 rounded-lg border border-gray-200 text-gray-700 text-[14px] font-bold hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button 
            onClick={() => selectedImage && handleInsert(selectedImage)}
            disabled={!selectedImage}
            className="px-6 py-2.5 rounded-lg bg-[#533EEC] text-white text-[14px] font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            Insert Image
          </button>
        </div>

      </div>
    </div>
  );
}
