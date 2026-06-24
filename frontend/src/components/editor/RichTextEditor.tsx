import React, { useCallback, useEffect } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import EmojiPicker, { type EmojiClickData } from 'emoji-picker-react';
import { 
  Bold, Italic, Underline as UnderlineIcon, Strikethrough as StrikethroughIcon,
  List, ListOrdered, Link as LinkIcon, Image as ImageIcon, Smile,
  AlignLeft, AlignCenter, AlignRight, MoreHorizontal, ChevronDown, Eye, Edit3
} from 'lucide-react';
import { cn } from '../../utils/cn';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  onFocus?: () => void;
  onTriggerVariable?: (rect: DOMRect) => void;
  editorRef?: React.MutableRefObject<Editor | null>;
}

const MenuBar = ({ editor }: { editor: any }) => {
  const [showEmoji, setShowEmoji] = React.useState(false);
  const [showStyle, setShowStyle] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);

  if (!editor) return null;

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);

    if (url === null) return;

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const uploadImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          editor.chain().focus().setImage({ src: e.target?.result as string }).run();
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    editor.chain().focus().insertContent(emojiData.emoji).run();
    setShowEmoji(false);
  };

  const currentStyleLabel = editor.isActive('heading', { level: 1 }) ? 'Heading 1' :
                            editor.isActive('heading', { level: 2 }) ? 'Heading 2' :
                            editor.isActive('heading', { level: 3 }) ? 'Heading 3' :
                            editor.isActive('heading', { level: 4 }) ? 'Heading 4' : 'Normal';

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-gray-200 px-4 py-3 bg-white rounded-t-md relative">
      
      {/* Font Style Dropdown */}
      <div className="relative">
        <button 
          type="button" 
          onClick={() => setShowStyle(!showStyle)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50 px-2 py-1.5 rounded mr-2"
        >
          {currentStyleLabel} <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
        </button>
        {showStyle && (
          <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1">
            <button type="button" onClick={() => { editor.chain().focus().setParagraph().run(); setShowStyle(false); }} className={cn('block w-full text-left px-4 py-2 text-sm hover:bg-gray-50', editor.isActive('paragraph') && 'bg-gray-50 font-semibold')}>Normal</button>
            <button type="button" onClick={() => { editor.chain().focus().toggleHeading({ level: 1 }).run(); setShowStyle(false); }} className={cn('block w-full text-left px-4 py-2 text-sm hover:bg-gray-50', editor.isActive('heading', { level: 1 }) && 'bg-gray-50 font-semibold')}>Heading 1</button>
            <button type="button" onClick={() => { editor.chain().focus().toggleHeading({ level: 2 }).run(); setShowStyle(false); }} className={cn('block w-full text-left px-4 py-2 text-sm hover:bg-gray-50', editor.isActive('heading', { level: 2 }) && 'bg-gray-50 font-semibold')}>Heading 2</button>
            <button type="button" onClick={() => { editor.chain().focus().toggleHeading({ level: 3 }).run(); setShowStyle(false); }} className={cn('block w-full text-left px-4 py-2 text-sm hover:bg-gray-50', editor.isActive('heading', { level: 3 }) && 'bg-gray-50 font-semibold')}>Heading 3</button>
            <button type="button" onClick={() => { editor.chain().focus().toggleHeading({ level: 4 }).run(); setShowStyle(false); }} className={cn('block w-full text-left px-4 py-2 text-sm hover:bg-gray-50', editor.isActive('heading', { level: 4 }) && 'bg-gray-50 font-semibold')}>Heading 4</button>
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Formatting */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive('bold') && 'bg-gray-100 text-gray-900')}
        title="Bold"
      >
        <Bold className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive('italic') && 'bg-gray-100 text-gray-900')}
        title="Italic"
      >
        <Italic className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive('underline') && 'bg-gray-100 text-gray-900')}
        title="Underline"
      >
        <UnderlineIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive('strike') && 'bg-gray-100 text-gray-900')}
        title="Strikethrough"
      >
        <StrikethroughIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={setLink}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive('link') && 'bg-gray-100 text-gray-900')}
        title="Link"
      >
        <LinkIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={uploadImage}
        className="p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors"
        title="Image"
      >
        <ImageIcon className="w-4 h-4" />
      </button>
      
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowEmoji(!showEmoji)}
          className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', showEmoji && 'bg-gray-100 text-gray-900')}
          title="Emoji"
        >
          <Smile className="w-4 h-4" />
        </button>
        {showEmoji && (
          <div className="absolute top-full left-0 mt-1 z-50 shadow-lg rounded-lg border border-gray-200">
            <EmojiPicker onEmojiClick={onEmojiClick} width={300} height={400} />
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Lists */}
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive('bulletList') && 'bg-gray-100 text-gray-900')}
        title="Bullet List"
      >
        <List className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive('orderedList') && 'bg-gray-100 text-gray-900')}
        title="Numbered List"
      >
        <ListOrdered className="w-4 h-4" />
      </button>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* Alignment */}
      <button
        type="button"
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive({ textAlign: 'left' }) && 'bg-gray-100 text-gray-900')}
        title="Align Left"
      >
        <AlignLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive({ textAlign: 'center' }) && 'bg-gray-100 text-gray-900')}
        title="Align Center"
      >
        <AlignCenter className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', editor.isActive({ textAlign: 'right' }) && 'bg-gray-100 text-gray-900')}
        title="Align Right"
      >
        <AlignRight className="w-4 h-4" />
      </button>

      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* More */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowMore(!showMore)}
          className={cn('p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors', showMore && 'bg-gray-100 text-gray-900')}
          title="More options"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {showMore && (
          <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1">
            <button type="button" onClick={() => { editor.chain().focus().toggleBlockquote().run(); setShowMore(false); }} className={cn('block w-full text-left px-4 py-2 text-sm hover:bg-gray-50', editor.isActive('blockquote') && 'bg-gray-50 font-semibold')}>Blockquote</button>
            <button type="button" onClick={() => { editor.chain().focus().toggleCodeBlock().run(); setShowMore(false); }} className={cn('block w-full text-left px-4 py-2 text-sm hover:bg-gray-50', editor.isActive('codeBlock') && 'bg-gray-50 font-semibold')}>Code Block</button>
            <button type="button" onClick={() => { editor.chain().focus().setHorizontalRule().run(); setShowMore(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50">Horizontal Rule</button>
            <div className="h-px bg-gray-200 my-1" />
            <button type="button" onClick={() => { editor.chain().focus().unsetAllMarks().clearNodes().run(); setShowMore(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 text-red-600">Clear Formatting</button>
            <div className="h-px bg-gray-200 my-1" />
            <button type="button" onClick={() => { editor.chain().focus().undo().run(); setShowMore(false); }} disabled={!editor.can().undo()} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">Undo (Ctrl+Z)</button>
            <button type="button" onClick={() => { editor.chain().focus().redo().run(); setShowMore(false); }} disabled={!editor.can().redo()} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">Redo (Ctrl+Shift+Z)</button>
          </div>
        )}
      </div>
    </div>
  );
};

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, error, onFocus, onTriggerVariable, editorRef }) => {
  const [viewMode, setViewMode] = React.useState<'edit' | 'preview'>('edit');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Image,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());

      if (onTriggerVariable) {
        const { state, view } = editor;
        const { selection, doc } = state;
        const textBefore = doc.textBetween(Math.max(0, selection.from - 2), selection.from, '\n');
        if (textBefore === '{{') {
          const coords = view.coordsAtPos(selection.from);
          onTriggerVariable({
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            right: coords.right,
            width: 0,
            height: coords.bottom - coords.top,
            x: coords.left,
            y: coords.top,
            toJSON: () => {}
          } as DOMRect);
        }
      }
    },
    onFocus: () => {
      if (onFocus) onFocus();
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none w-full min-h-[16rem]',
      },
    },
  });

  useEffect(() => {
    if (editorRef && editor) {
      editorRef.current = editor;
    }
  }, [editor, editorRef]);

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  return (
    <div className={cn(
      "w-full rounded-md border bg-white focus-within:ring-2 focus-within:ring-indigo-500",
      error ? "border-red-300 focus-within:ring-red-500" : "border-gray-300",
      "flex flex-col overflow-hidden"
    )}>
      <div className="flex items-center justify-between bg-gray-50 border-b border-gray-200 px-2 min-h-[48px]">
        {viewMode === 'edit' ? (
          <MenuBar editor={editor} />
        ) : (
          <div className="p-2 text-sm font-medium text-gray-600 flex-1">Preview Mode</div>
        )}
        
        <div className="flex bg-gray-200/50 p-1 rounded-md ml-auto mr-2">
          <button
            type="button"
            onClick={() => setViewMode('edit')}
            className={cn('px-3 py-1 text-xs font-medium rounded transition-all flex items-center gap-1', viewMode === 'edit' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-600 hover:text-gray-900')}
          >
            <Edit3 className="w-3 h-3" /> Edit
          </button>
          <button
            type="button"
            onClick={() => setViewMode('preview')}
            className={cn('px-3 py-1 text-xs font-medium rounded transition-all flex items-center gap-1', viewMode === 'preview' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-600 hover:text-gray-900')}
          >
            <Eye className="w-3 h-3" /> Preview
          </button>
        </div>
      </div>

      <div className={cn("p-4 text-sm text-gray-900 min-h-[16rem] tiptap-content", viewMode === 'preview' ? 'block' : 'hidden')}>
        <div dangerouslySetInnerHTML={{ __html: value || '<p class="text-gray-400 italic">No content</p>' }} />
      </div>

      <div className={cn("p-4 text-sm text-gray-900 min-h-[16rem] cursor-text tiptap-content", viewMode === 'edit' ? 'block' : 'hidden')} onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} />
      </div>
      
      {/* Editor Footer / Word Count Placeholder */}
      <div className="px-4 py-2 border-t border-gray-100 flex justify-end bg-white">
        <span className="text-xs text-gray-400 font-medium">{editor?.getText().split(/\s+/).filter(word => word.length > 0).length || 0} words</span>
      </div>
    </div>
  );
};
