import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  ChevronDown, 
  Menu, 
  X, 
  Sparkles, 
  Zap, 
  ShieldCheck, 
  BarChart3, 
  Mail, 
  Users, 
  Layers, 
  ArrowRight,
  Database,
  CheckCircle2,
  Workflow
} from 'lucide-react';

interface NavbarLandingProps {
  onOpenDemoModal: () => void;
}

export const NavbarLanding: React.FC<NavbarLandingProps> = ({ onOpenDemoModal }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const closeDropdowns = () => setActiveDropdown(null);

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled 
          ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100 py-3' 
          : 'bg-white/90 backdrop-blur-sm py-4 border-b border-gray-100/60'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          
          {/* ── Brand Logo ── */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 via-indigo-600 to-cyan-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <span className="font-extrabold text-xl tracking-tight">CL</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-1">
                Cloudlead <span className="text-blue-600 text-xs font-bold uppercase tracking-widest px-1.5 py-0.5 bg-blue-50 rounded border border-blue-200">AI</span>
              </span>
              <span className="text-[10px] font-semibold text-gray-600 -mt-1 tracking-wider uppercase">Email Sequencing</span>
            </div>
          </Link>

          {/* ── Desktop Navigation Links ── */}
          <nav className="hidden lg:flex items-center gap-1 xl:gap-2">
            
            {/* Platform Dropdown */}
            <div 
              className="relative"
              onMouseEnter={() => setActiveDropdown('platform')}
              onMouseLeave={closeDropdowns}
            >
              <button 
                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeDropdown === 'platform' ? 'text-blue-600 bg-blue-50/60' : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                }`}
              >
                Platform
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${activeDropdown === 'platform' ? 'rotate-180 text-blue-600' : 'text-gray-400'}`} />
              </button>

              {activeDropdown === 'platform' && (
                <div className="absolute top-full left-0 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 p-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="space-y-1">
                    <a href="#features" onClick={closeDropdowns} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-blue-50/70 transition-colors group">
                      <div className="p-2 rounded-lg bg-blue-100 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        <Workflow className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-900 group-hover:text-blue-600">Visual Sequence Builder</div>
                        <div className="text-xs text-gray-500">Multi-step drip campaigns & conditional logic</div>
                      </div>
                    </a>

                    <a href="#features" onClick={closeDropdowns} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-purple-50/70 transition-colors group">
                      <div className="p-2 rounded-lg bg-purple-100 text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-900 group-hover:text-purple-600">Smart AI Writer</div>
                        <div className="text-xs text-gray-500">Gemini-powered hyper-personalized copy</div>
                      </div>
                    </a>

                    <a href="#features" onClick={closeDropdowns} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-emerald-50/70 transition-colors group">
                      <div className="p-2 rounded-lg bg-emerald-100 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-900 group-hover:text-emerald-600">Deliverability & Warmup</div>
                        <div className="text-xs text-gray-500">Automated inbox ramp-up & SPF/DKIM check</div>
                      </div>
                    </a>

                    <a href="#features" onClick={closeDropdowns} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-cyan-50/70 transition-colors group">
                      <div className="p-2 rounded-lg bg-cyan-100 text-cyan-600 group-hover:bg-cyan-600 group-hover:text-white transition-colors">
                        <Layers className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-900 group-hover:text-cyan-600">Multi-Inbox Rotation</div>
                        <div className="text-xs text-gray-500">Rotate unlimited Gmail & Outlook accounts</div>
                      </div>
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Pricing */}
            <a 
              href="#pricing" 
              className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:text-blue-600 hover:bg-gray-50 transition-colors"
            >
              Pricing
            </a>

            {/* Resources & Tools Dropdown */}
            <div 
              className="relative"
              onMouseEnter={() => setActiveDropdown('resources')}
              onMouseLeave={closeDropdowns}
            >
              <button 
                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeDropdown === 'resources' ? 'text-blue-600 bg-blue-50/60' : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                }`}
              >
                Resources & Tools
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${activeDropdown === 'resources' ? 'rotate-180 text-blue-600' : 'text-gray-400'}`} />
              </button>

              {activeDropdown === 'resources' && (
                <div className="absolute top-full left-0 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 p-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="space-y-1">
                    <a href="#demo" onClick={closeDropdowns} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                      <BarChart3 className="w-4 h-4 text-blue-600" />
                      <div className="text-sm font-semibold text-gray-800">Live Interactive Demo</div>
                    </a>
                    <a href="#stats" onClick={closeDropdowns} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                      <Database className="w-4 h-4 text-indigo-600" />
                      <div className="text-sm font-semibold text-gray-800">B2B Intelligence Database</div>
                    </a>
                    <a href="#faq" onClick={closeDropdowns} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <div className="text-sm font-semibold text-gray-800">Deliverability Guide</div>
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Services */}
            <a 
              href="#features" 
              className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:text-blue-600 hover:bg-gray-50 transition-colors"
            >
              Services
            </a>

            {/* Solutions */}
            <a 
              href="#features" 
              className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:text-blue-600 hover:bg-gray-50 transition-colors"
            >
              Solutions
            </a>

            {/* Support */}
            <a 
              href="#faq" 
              className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:text-blue-600 hover:bg-gray-50 transition-colors"
            >
              Support
            </a>
          </nav>

          {/* ── Right Actions ── */}
          <div className="hidden lg:flex items-center gap-3">
            <Link 
              to="/login" 
              className="px-4 py-2 text-sm font-bold text-gray-700 hover:text-blue-600 transition-colors"
            >
              Login
            </Link>

            <Link 
              to="/dashboard"
              className="relative inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/35 active:scale-95 transition-all"
            >
              <span>Get Started Free</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <button 
              onClick={onOpenDemoModal}
              className="px-4 py-2.5 rounded-xl text-sm font-bold text-blue-700 border-2 border-blue-600 hover:bg-blue-50 active:scale-95 transition-all"
            >
              Talk To Us
            </button>
          </div>

          {/* ── Mobile Hamburger Button ── */}
          <div className="lg:hidden flex items-center gap-2">
            <Link 
              to="/dashboard"
              className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-lg"
            >
              Start Free
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

        </div>
      </div>

      {/* ── Mobile Navigation Drawer ── */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white border-b border-gray-200 px-4 pt-3 pb-6 space-y-3 animate-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-1 gap-1">
            <a 
              href="#features" 
              onClick={() => setMobileMenuOpen(false)} 
              className="px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-blue-50 rounded-lg"
            >
              Platform & Features
            </a>
            <a 
              href="#stats" 
              onClick={() => setMobileMenuOpen(false)} 
              className="px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-blue-50 rounded-lg"
            >
              Data Intelligence
            </a>
            <a 
              href="#pricing" 
              onClick={() => setMobileMenuOpen(false)} 
              className="px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-blue-50 rounded-lg"
            >
              Pricing
            </a>
            <a 
              href="#faq" 
              onClick={() => setMobileMenuOpen(false)} 
              className="px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-blue-50 rounded-lg"
            >
              FAQ & Support
            </a>
          </div>

          <div className="pt-3 border-t border-gray-100 flex flex-col gap-2">
            <Link 
              to="/login" 
              className="w-full text-center py-2.5 rounded-lg text-sm font-bold text-gray-700 border border-gray-200"
            >
              Login
            </Link>
            <Link 
              to="/dashboard" 
              className="w-full text-center py-2.5 rounded-lg text-sm font-bold text-white bg-blue-600 shadow"
            >
              Get Started Free
            </Link>
            <button 
              onClick={() => { setMobileMenuOpen(false); onOpenDemoModal(); }} 
              className="w-full text-center py-2.5 rounded-lg text-sm font-bold text-blue-700 border border-blue-300"
            >
              Talk To Us
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
