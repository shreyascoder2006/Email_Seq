import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { NavbarLanding } from '../components/landing/NavbarLanding';
import { DemoModal } from '../components/landing/DemoModal';
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Database,
  Target,
  Zap,
  ShieldCheck,
  BarChart3,
  Globe2,
  Users,
  Building2,
  TrendingUp,
  Play,
  Mail,
  ChevronDown,
  Layers,
  Clock,
  Send,
  Lock,
  Workflow,
  Check,
  HelpCircle,
  Award,
  Filter,
  CheckCheck
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [activeDemoTab, setActiveDemoTab] = useState<'builder' | 'aiWriter' | 'analytics'>('builder');
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  const toggleFaq = (idx: number) => {
    setOpenFaqIdx(openFaqIdx === idx ? null : idx);
  };

  const faqs = [
    {
      q: 'How does Cloudlead guarantee 95%+ email deliverability?',
      a: 'We combine automated inbox warmup, SPF/DKIM/DMARC health verification, multi-account inbox rotation, and real-time spam-trigger scanning to ensure your cold emails land directly in the primary inbox rather than the spam folder.'
    },
    {
      q: 'Can I connect my existing Gmail / Google Workspace or Outlook accounts?',
      a: 'Yes! You can connect unlimited Google Workspace accounts (using Google App Passwords) and Microsoft 365 / Outlook accounts via secure SMTP/IMAP protocols in under 60 seconds.'
    },
    {
      q: 'How does the Smart AI Writer create personalized cold emails?',
      a: 'Our built-in AI Writer uses state-of-the-art LLMs to generate high-converting email subjects and multi-step copy based on your specific offering, target persona, pain points, and call to action.'
    },
    {
      q: 'What happens when a prospect replies to an automated sequence?',
      a: 'Cloudlead includes automatic IMAP reply detection. As soon as a prospect replies or books a meeting, their sequence is instantly paused to ensure seamless human handoff and prevent awkward follow-ups.'
    },
    {
      q: 'Can I import my own prospect lists and CSV files?',
      a: 'Absolutely. You can upload custom CSV lists with custom columns (First Name, Company, Job Title, Industry, Custom Variables), and map them directly into merge tags like {{first_name}} and {{company}}.'
    },
    {
      q: 'Is Cloudlead compliant with GDPR and CAN-SPAM regulations?',
      a: 'Yes. Cloudlead automatically embeds one-click unsubscribe links and headers (RFC 8058 & RFC 2369 compliant) and honors global unsubscribe and bounce suppressions instantly.'
    }
  ];

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 selection:bg-blue-600 selection:text-white">
      {/* ── Sticky Navbar ── */}
      <NavbarLanding onOpenDemoModal={() => setIsDemoModalOpen(true)} />

      {/* ── Demo / Consultation Modal ── */}
      <DemoModal isOpen={isDemoModalOpen} onClose={() => setIsDemoModalOpen(false)} />

      {/* ════════════════════════════════════════════════════════════════
          SECTION 1: HERO SECTION (Dark Blue Theme - Screenshot 3)
         ════════════════════════════════════════════════════════════════ */}
      <section className="relative pt-32 pb-24 lg:pt-40 lg:pb-32 overflow-hidden bg-gradient-to-b from-[#0b246a] via-[#103b9b] to-[#1a56db] text-white">
        
        {/* Decorative Grid Mesh & Radial Glows */}
        <div 
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.4) 1px, transparent 0)`,
            backgroundSize: '40px 40px'
          }}
        />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-blue-400/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-cyan-400/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Floating Badges Grid Layout Container */}
          <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto">
            
            {/* Top Pill Badge: "Trusted by 10,000+ businesses worldwide" */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-md text-xs font-semibold text-white mb-8 shadow-inner animate-in fade-in zoom-in-95 duration-500">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Trusted by 10,000+ businesses worldwide</span>
            </div>

            {/* Main Hero Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-[1.12] mb-6">
              An Easy-To-Use{' '}
              <span className="text-amber-300 drop-shadow-sm">
                Lead Generation
              </span>{' '}
              Platform For All Your Business Needs
            </h1>

            {/* Hero Subtitle */}
            <p className="text-base sm:text-lg lg:text-xl text-blue-100/90 max-w-3xl leading-relaxed mb-10">
              Access verified B2B contacts, build targeted prospect lists, and accelerate your sales pipeline with our comprehensive data intelligence and AI email sequencing platform.
            </p>

            {/* CTAs Button Group */}
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto mb-14">
              <Link
                to="/dashboard"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-full text-base font-extrabold text-white bg-blue-600 hover:bg-blue-500 shadow-xl shadow-blue-900/40 hover:shadow-blue-500/50 hover:scale-[1.02] active:scale-95 transition-all"
              >
                <span>Get Started Free</span>
                <ArrowRight className="w-5 h-5" />
              </Link>

              <button
                onClick={() => setIsDemoModalOpen(true)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full text-base font-bold text-white bg-white/10 hover:bg-white/20 border border-white/30 backdrop-blur-md hover:border-white/50 active:scale-95 transition-all"
              >
                <Play className="w-4 h-4 text-blue-200 fill-blue-200" />
                <span>Schedule A Demo</span>
              </button>
            </div>

            {/* Trust Metrics Bar at bottom of Hero */}
            <div className="pt-8 border-t border-white/15 w-full flex flex-wrap items-center justify-center gap-y-3 gap-x-6 sm:gap-x-8 text-xs sm:text-sm font-semibold text-blue-100/90">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>95% Email Accuracy</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>50M+ Verified Contacts</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>Real-Time Data Updates</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>GDPR Compliant</span>
              </div>
            </div>

          </div>

          {/* ── Floating Badges (Desktop Positioning) ── */}
          {/* Top-Left Badge: Data Accuracy */}
          <div className="hidden lg:flex absolute top-28 left-4 xl:left-12 items-center gap-3 p-3.5 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md shadow-2xl text-white animate-bounce duration-[4000ms]">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <div>
              <div className="text-[10px] uppercase font-bold tracking-widest text-blue-200">Data Accuracy</div>
              <div className="text-sm font-black text-white">99.9% Precision</div>
            </div>
          </div>

          {/* Bottom-Left Badge: Cloud Status */}
          <div className="hidden lg:flex absolute bottom-24 left-6 xl:left-16 items-center gap-3 p-3.5 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md shadow-2xl text-white">
            <div className="p-2 rounded-xl bg-blue-500/30 text-cyan-300">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold tracking-widest text-blue-200">Cloud Status</div>
              <div className="text-sm font-black text-white">Encrypted & Secure</div>
            </div>
          </div>

          {/* Right Badge: Real-Time Fast Sync */}
          <div className="hidden lg:flex absolute top-1/2 -translate-y-1/2 right-4 xl:right-14 items-center gap-3 p-3.5 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md shadow-2xl text-white">
            <div className="p-2 rounded-xl bg-indigo-500/40 text-amber-300">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold tracking-widest text-blue-200">Real-Time</div>
              <div className="text-sm font-black text-white">Fast Sync</div>
            </div>
          </div>

        </div>
      </section>


      {/* ════════════════════════════════════════════════════════════════
          SECTION 2: DATA INTELLIGENCE & 2x2 METRICS (Screenshot 1)
         ════════════════════════════════════════════════════════════════ */}
      <section id="stats" className="py-20 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            
            {/* Left Column: Heading & Value Proposition */}
            <div className="lg:col-span-6 space-y-6">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-gray-900 tracking-tight leading-tight">
                Powerful B2B Data Intelligence At Your Fingertips
              </h2>

              <p className="text-base text-gray-600 leading-relaxed">
                Cloudlead combines advanced data technology with human verification to deliver the most accurate B2B contact information available. Our platform helps you identify decision-makers, enrich your CRM data, and accelerate your sales cycle.
              </p>

              {/* Checkmark Bullet Points */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3 text-sm font-semibold text-gray-800">
                  <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span>Access 200M+ verified B2B contacts</span>
                </div>

                <div className="flex items-center gap-3 text-sm font-semibold text-gray-800">
                  <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span>Real-time data verification & enrichment</span>
                </div>

                <div className="flex items-center gap-3 text-sm font-semibold text-gray-800">
                  <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span>Seamless CRM integrations</span>
                </div>

                <div className="flex items-center gap-3 text-sm font-semibold text-gray-800">
                  <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                  <span>GDPR & CCPA compliant data practices</span>
                </div>
              </div>

              {/* Link CTA */}
              <div className="pt-4">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center gap-2 text-base font-extrabold text-blue-600 hover:text-blue-700 group transition-colors"
                >
                  <span>Explore Our Database</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>

            {/* Right Column: 2x2 Stats Card Grid Container (Screenshot 1 Card Box) */}
            <div className="lg:col-span-6">
              <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-tr from-blue-50/80 via-indigo-50/40 to-cyan-50/60 border border-blue-100 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  
                  {/* Card 1: 200M+ B2B Contacts */}
                  <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                      <Users className="w-5 h-5" />
                    </div>
                    <div className="text-3xl font-black text-gray-900 tracking-tight">200M+</div>
                    <div className="text-xs font-semibold text-gray-500 mt-1">B2B Contacts</div>
                  </div>

                  {/* Card 2: 50M+ Companies */}
                  <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div className="text-3xl font-black text-gray-900 tracking-tight">50M+</div>
                    <div className="text-xs font-semibold text-gray-500 mt-1">Companies</div>
                  </div>

                  {/* Card 3: 95%+ Data Accuracy */}
                  <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div className="text-3xl font-black text-gray-900 tracking-tight">95%+</div>
                    <div className="text-xs font-semibold text-gray-500 mt-1">Data Accuracy</div>
                  </div>

                  {/* Card 4: 100+ Countries */}
                  <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                    <div className="text-3xl font-black text-gray-900 tracking-tight">100+</div>
                    <div className="text-xs font-semibold text-gray-500 mt-1">Countries</div>
                  </div>

                </div>
              </div>
            </div>

          </div>

        </div>
      </section>


      {/* ════════════════════════════════════════════════════════════════
          SECTION 3: FEATURES GRID / WHY CHOOSE US (Screenshot 2)
         ════════════════════════════════════════════════════════════════ */}
      <section id="features" className="py-20 lg:py-28 bg-gray-50/60 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Section Header */}
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100/80 text-blue-700 text-xs font-bold uppercase tracking-wider mb-4">
              Why Choose Us
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-gray-900 tracking-tight leading-tight mb-4">
              Everything You Need To Grow Your Business
            </h2>
            <p className="text-base text-gray-600 leading-relaxed">
              Our platform provides all the tools you need to find, engage, and convert your ideal customers into loyal clients.
            </p>
          </div>

          {/* 6-Card Feature Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            
            {/* Card 1: B2B Contacts Database (Blue) */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center mb-6 shadow-md shadow-blue-500/20">
                <Database className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                B2B Contacts Database
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Access millions of verified business contacts with accurate email addresses and company information.
              </p>
            </div>

            {/* Card 2: Targeted Lead Lists (Teal) */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-teal-500 text-white flex items-center justify-center mb-6 shadow-md shadow-teal-500/20">
                <Target className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                Targeted Lead Lists
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Build precise prospect lists using advanced filters like industry, company size, job title, and location.
              </p>
            </div>

            {/* Card 3: Automated Sequences (Purple) */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center mb-6 shadow-md shadow-indigo-500/20">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                Automated Sequences
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Create personalized outreach campaigns and automate your follow-up process for better engagement.
              </p>
            </div>

            {/* Card 4: Data Accuracy Guarantee (Purple/Violet) */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-purple-600 text-white flex items-center justify-center mb-6 shadow-md shadow-purple-500/20">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                Data Accuracy Guarantee
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Our rigorous verification process ensures you get the highest quality leads with minimal bounce rates.
              </p>
            </div>

            {/* Card 5: Analytics & Insights (Green) */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center mb-6 shadow-md shadow-emerald-500/20">
                <BarChart3 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                Analytics & Insights
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Track campaign performance, monitor engagement metrics, and optimize your outreach strategy with real-time data.
              </p>
            </div>

            {/* Card 6: Global Coverage (Cyan) */}
            <div className="bg-white p-8 rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-cyan-600 text-white flex items-center justify-center mb-6 shadow-md shadow-cyan-500/20">
                <Globe2 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                Global Coverage
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Reach prospects across 100+ countries with our comprehensive database of international business contacts.
              </p>
            </div>

          </div>

        </div>
      </section>


      {/* ════════════════════════════════════════════════════════════════
          SECTION 4: INTERACTIVE PRODUCT TOUR & DEMO
         ════════════════════════════════════════════════════════════════ */}
      <section id="demo" className="py-20 lg:py-28 bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-12">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold uppercase tracking-wider mb-4">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              Experience The Platform
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-gray-900 tracking-tight leading-tight mb-4">
              Built For Maximum Cold Email Conversions
            </h2>
            <p className="text-base text-gray-600 leading-relaxed">
              Explore how effortless it is to generate high-converting sequences, rotate inboxes, and track pipeline metrics.
            </p>
          </div>

          {/* Interactive Tab Switcher */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex p-1.5 rounded-2xl bg-gray-100 border border-gray-200">
              <button
                onClick={() => setActiveDemoTab('builder')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  activeDemoTab === 'builder'
                    ? 'bg-white text-blue-600 shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Workflow className="w-4 h-4" />
                Visual Sequence Wizard
              </button>

              <button
                onClick={() => setActiveDemoTab('aiWriter')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  activeDemoTab === 'aiWriter'
                    ? 'bg-white text-purple-600 shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                Smart AI Email Writer
              </button>

              <button
                onClick={() => setActiveDemoTab('analytics')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  activeDemoTab === 'analytics'
                    ? 'bg-white text-emerald-600 shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                Real-Time Tracking
              </button>
            </div>
          </div>

          {/* Mock Interactive Interface Window */}
          <div className="max-w-5xl mx-auto rounded-2xl border border-gray-200 shadow-2xl overflow-hidden bg-gray-900 text-gray-100">
            
            {/* Window Topbar */}
            <div className="bg-gray-800/90 px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500" />
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                <span className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="text-xs text-gray-400 font-mono ml-2">cloudlead-outbound-v2.0</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded-md">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live Engine Active
              </div>
            </div>

            {/* Window Content */}
            <div className="p-6 sm:p-8 bg-gray-950 min-h-[380px] flex flex-col justify-center">
              
              {/* TAB 1: Visual Sequence Wizard */}
              {activeDemoTab === 'builder' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                    <div>
                      <div className="text-sm font-bold text-white">Outbound Growth Campaign #1</div>
                      <div className="text-xs text-gray-400">Sender: Shreyas Kale &lt;shreyaskale800@gmail.com&gt;</div>
                    </div>
                    <span className="text-xs bg-blue-900/60 text-blue-300 border border-blue-700 px-2.5 py-1 rounded-full font-bold">3 Steps Active</span>
                  </div>

                  {/* Steps Flow Diagram */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="p-4 rounded-xl bg-gray-900 border border-blue-500/40 relative">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-blue-400 uppercase">Phase 1</span>
                        <span className="text-[10px] bg-blue-950 text-blue-300 px-2 py-0.5 rounded">Immediate</span>
                      </div>
                      <div className="text-sm font-bold text-white">Cold Intro & Value Prop</div>
                      <div className="text-xs text-gray-400 mt-1">"Quick question regarding your outbound pipeline, &#123;&#123;first_name&#125;&#125;"</div>
                      <div className="mt-3 text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                        <CheckCheck className="w-3.5 h-3.5" /> 78% Open Rate • 14% Reply
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 relative">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-amber-400 uppercase">Phase 2</span>
                        <span className="text-[10px] bg-gray-800 text-gray-300 px-2 py-0.5 rounded">Wait 2 Days</span>
                      </div>
                      <div className="text-sm font-bold text-white">Case Study & Social Proof</div>
                      <div className="text-xs text-gray-400 mt-1">"How SaaS company scaled replies by 340%..."</div>
                      <div className="mt-3 text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                        <CheckCheck className="w-3.5 h-3.5" /> 64% Open Rate • 22% Reply
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 relative">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-purple-400 uppercase">Phase 3</span>
                        <span className="text-[10px] bg-gray-800 text-gray-300 px-2 py-0.5 rounded">Wait 4 Days</span>
                      </div>
                      <div className="text-sm font-bold text-white">Permission to Close File</div>
                      <div className="text-xs text-gray-400 mt-1">"Should I follow up next quarter or close out?"</div>
                      <div className="mt-3 text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                        <CheckCheck className="w-3.5 h-3.5" /> 51% Open Rate • 9% Reply
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Smart AI Writer */}
              {activeDemoTab === 'aiWriter' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-800/60 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-purple-600 text-white">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">Gemini Cold Email Generator</div>
                        <div className="text-xs text-purple-200">Objective: Meeting Request • Audience: B2B Founders</div>
                      </div>
                    </div>
                    <span className="text-xs bg-purple-900 text-purple-200 px-3 py-1 rounded-full font-bold">Generated in 1.2s</span>
                  </div>

                  <div className="bg-gray-900 p-5 rounded-xl border border-gray-800 font-mono text-xs text-gray-200 space-y-2">
                    <div className="text-purple-400 font-bold">Subject: Scaling outbound for &#123;&#123;company&#125;&#125; without deliverability headaches</div>
                    <p className="leading-relaxed text-gray-300">
                      Hi &#123;&#123;first_name&#125;&#125;,<br /><br />
                      Saw that &#123;&#123;company&#125;&#125; is scaling your sales team this quarter. Most founders we speak with struggle with domain reputation and spam traps when launching cold outreach.<br /><br />
                      We built Cloudlead to automate multi-inbox rotation and achieve 95%+ inbox placement with AI-tailored follow-ups.<br /><br />
                      Would you be open to a 10-minute chat next Tuesday at 2 PM?
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 3: Real-Time Analytics */}
              {activeDemoTab === 'analytics' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                      <div className="text-xs text-gray-400 font-bold">Total Sent</div>
                      <div className="text-2xl font-black text-white mt-1">12,450</div>
                      <div className="text-[11px] text-emerald-400 mt-1">↑ 100% delivered</div>
                    </div>
                    <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                      <div className="text-xs text-gray-400 font-bold">Open Rate</div>
                      <div className="text-2xl font-black text-blue-400 mt-1">74.2%</div>
                      <div className="text-[11px] text-gray-400 mt-1">9,238 opens</div>
                    </div>
                    <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                      <div className="text-xs text-gray-400 font-bold">Reply Rate</div>
                      <div className="text-2xl font-black text-emerald-400 mt-1">18.6%</div>
                      <div className="text-[11px] text-emerald-400 mt-1">2,315 positive replies</div>
                    </div>
                    <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
                      <div className="text-xs text-gray-400 font-bold">Bounce Rate</div>
                      <div className="text-2xl font-black text-rose-400 mt-1">0.4%</div>
                      <div className="text-[11px] text-emerald-400 mt-1">Ultra-clean list</div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                      <span className="text-xs text-gray-300">Live Reply Log: <strong className="text-white">Alex Morgan (VP of Growth)</strong> replied 2 minutes ago</span>
                    </div>
                    <span className="text-xs text-emerald-400 font-bold">Sequence Auto-Paused</span>
                  </div>
                </div>
              )}

            </div>
          </div>

        </div>
      </section>


      {/* ════════════════════════════════════════════════════════════════
          SECTION 5: PRICING PLANS
         ════════════════════════════════════════════════════════════════ */}
      <section id="pricing" className="py-20 lg:py-28 bg-gray-50/70 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wider mb-4">
              Transparent Pricing
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-gray-900 tracking-tight leading-tight mb-4">
              Simple, Predictable Plans For Every Team
            </h2>
            <p className="text-base text-gray-600 leading-relaxed mb-8">
              Start with a 14-day free trial. No credit card required.
            </p>

            {/* Monthly / Annual Toggle */}
            <div className="inline-flex items-center gap-3 p-1.5 rounded-full bg-white border border-gray-200 shadow-sm">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${
                  billingCycle === 'monthly'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Monthly
              </button>

              <button
                onClick={() => setBillingCycle('annual')}
                className={`px-5 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all ${
                  billingCycle === 'annual'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>Annual</span>
                <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-extrabold">
                  Save 20%
                </span>
              </button>
            </div>
          </div>

          {/* Pricing Tier Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto items-stretch">
            
            {/* Starter Plan */}
            <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Starter</h3>
                <p className="text-xs text-gray-500 mb-6">For individual founders & solo SDRs</p>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-black text-gray-900">
                    ${billingCycle === 'annual' ? '29' : '39'}
                  </span>
                  <span className="text-sm font-semibold text-gray-500">/ month</span>
                </div>

                <div className="space-y-3 text-sm text-gray-700 mb-8">
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Up to <strong>2 Connected Email Accounts</strong></span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>5,000 Active Contacts</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Smart AI Email Writer (100 gens/mo)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Open & Click Tracking</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Automated Reply Detection</span>
                  </div>
                </div>
              </div>

              <Link
                to="/dashboard"
                className="w-full py-3 text-center rounded-xl font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors"
              >
                Start Free 14-Day Trial
              </Link>
            </div>

            {/* Growth / Pro Plan (Highlighted) */}
            <div className="bg-gradient-to-b from-blue-900 to-indigo-900 text-white p-8 rounded-3xl shadow-2xl border-2 border-blue-400 relative flex flex-col justify-between scale-105">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-gray-900 font-extrabold text-xs uppercase tracking-wider shadow-md">
                Most Popular
              </div>

              <div>
                <h3 className="text-xl font-bold text-white mb-1">Growth</h3>
                <p className="text-xs text-blue-200 mb-6">For scaling outbound teams & agencies</p>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-black text-white">
                    ${billingCycle === 'annual' ? '79' : '99'}
                  </span>
                  <span className="text-sm font-semibold text-blue-200">/ month</span>
                </div>

                <div className="space-y-3 text-sm text-blue-100 mb-8">
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>Up to <strong>10 Connected Email Accounts</strong></span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>25,000 Active Contacts</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>Multi-Account Inbox Rotation</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>Unlimited Smart AI Generation</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>Automated Warmup & Health Monitoring</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-amber-300 shrink-0" />
                    <span>Priority Support</span>
                  </div>
                </div>
              </div>

              <Link
                to="/dashboard"
                className="w-full py-3.5 text-center rounded-xl font-extrabold text-gray-900 bg-amber-400 hover:bg-amber-300 shadow-lg shadow-amber-500/25 active:scale-95 transition-all"
              >
                Start Free 14-Day Trial
              </Link>
            </div>

            {/* Scale / Enterprise Plan */}
            <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Scale</h3>
                <p className="text-xs text-gray-500 mb-6">For large enterprises & lead gen firms</p>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-black text-gray-900">
                    ${billingCycle === 'annual' ? '199' : '249'}
                  </span>
                  <span className="text-sm font-semibold text-gray-500">/ month</span>
                </div>

                <div className="space-y-3 text-sm text-gray-700 mb-8">
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span><strong>Unlimited Connected Accounts</strong></span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>100,000+ Active Contacts</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Custom Dedicated IPs</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>API & Webhook Integrations</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Dedicated Outbound Strategist</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setIsDemoModalOpen(true)}
                className="w-full py-3 text-center rounded-xl font-bold text-gray-900 bg-gray-100 hover:bg-gray-200 border border-gray-300 transition-colors"
              >
                Talk to Sales
              </button>
            </div>

          </div>

        </div>
      </section>


      {/* ════════════════════════════════════════════════════════════════
          SECTION 6: FREQUENTLY ASKED QUESTIONS (FAQ)
         ════════════════════════════════════════════════════════════════ */}
      <section id="faq" className="py-20 lg:py-28 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wider mb-4">
              Got Questions?
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, idx) => (
              <div 
                key={idx}
                className="border border-gray-200 rounded-2xl overflow-hidden transition-colors"
              >
                <button
                  onClick={() => toggleFaq(idx)}
                  className="w-full p-6 text-left font-bold text-gray-900 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-base sm:text-lg">{faq.q}</span>
                  <ChevronDown className={`w-5 h-5 text-gray-500 shrink-0 transition-transform duration-200 ${openFaqIdx === idx ? 'rotate-180 text-blue-600' : ''}`} />
                </button>

                {openFaqIdx === idx && (
                  <div className="px-6 pb-6 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-4 bg-gray-50/50 animate-in fade-in duration-150">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>

        </div>
      </section>


      {/* ════════════════════════════════════════════════════════════════
          SECTION 7: FINAL BOTTOM CTA BANNER
         ════════════════════════════════════════════════════════════════ */}
      <section className="py-20 bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-800 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:24px_24px]" />
        
        <div className="relative max-w-5xl mx-auto px-4 text-center space-y-8">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight">
            Supercharge Your Sales & Marketing Today
          </h2>
          <p className="text-base sm:text-lg text-blue-100 max-w-2xl mx-auto leading-relaxed">
            Join thousands of fast-growing businesses turning cold prospects into high-value clients with Cloudlead.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link
              to="/dashboard"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full text-base font-extrabold text-white bg-blue-600 hover:bg-blue-500 shadow-xl shadow-blue-950/40 active:scale-95 transition-all"
            >
              <span>Get Started Free</span>
              <ArrowRight className="w-5 h-5" />
            </Link>

            <button
              onClick={() => setIsDemoModalOpen(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full text-base font-bold text-white bg-white/10 hover:bg-white/20 border border-white/30 backdrop-blur-md active:scale-95 transition-all"
            >
              <span>Schedule A Demo</span>
            </button>
          </div>
        </div>
      </section>


      {/* ════════════════════════════════════════════════════════════════
          SECTION 8: FOOTER
         ════════════════════════════════════════════════════════════════ */}
      <footer className="bg-gray-950 text-gray-400 py-16 border-t border-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 mb-12">
            
            {/* Brand column */}
            <div className="lg:col-span-2 space-y-4">
              <Link to="/" className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-700 to-cyan-500 flex items-center justify-center text-white font-extrabold text-lg">
                  CL
                </div>
                <span className="text-xl font-black text-white tracking-tight">Cloudlead</span>
              </Link>
              <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
                Cloudlead is an enterprise-grade cold email sequencing and B2B lead intelligence platform designed for maximum inbox placement and outbound pipeline acceleration.
              </p>
              <div className="text-xs text-emerald-400 flex items-center gap-2 pt-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>All systems operational • 99.98% Uptime</span>
              </div>
            </div>

            {/* Col 1: Platform */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-gray-200 mb-4">Platform</div>
              <ul className="space-y-2.5 text-xs">
                <li><a href="#features" className="hover:text-white transition-colors">Visual Sequence Builder</a></li>
                <li><a href="#features" className="hover:text-white transition-colors">Smart AI Email Writer</a></li>
                <li><a href="#features" className="hover:text-white transition-colors">Deliverability Warmup</a></li>
                <li><a href="#features" className="hover:text-white transition-colors">Multi-Inbox Rotation</a></li>
                <li><a href="#stats" className="hover:text-white transition-colors">B2B Contacts Database</a></li>
              </ul>
            </div>

            {/* Col 2: Solutions */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-gray-200 mb-4">Solutions</div>
              <ul className="space-y-2.5 text-xs">
                <li><a href="#features" className="hover:text-white transition-colors">B2B Sales Teams</a></li>
                <li><a href="#features" className="hover:text-white transition-colors">Lead Gen Agencies</a></li>
                <li><a href="#features" className="hover:text-white transition-colors">SaaS Founders</a></li>
                <li><a href="#features" className="hover:text-white transition-colors">Recruiting & HR</a></li>
              </ul>
            </div>

            {/* Col 3: Legal & Security */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-gray-200 mb-4">Security & Legal</div>
              <ul className="space-y-2.5 text-xs">
                <li><span className="text-gray-400">GDPR Compliant</span></li>
                <li><span className="text-gray-400">CCPA Ready</span></li>
                <li><span className="text-gray-400">CAN-SPAM Verified</span></li>
                <li><span className="text-gray-400">SOC2 Type II Encrypted</span></li>
                <li><span className="text-gray-400">Privacy Policy</span></li>
              </ul>
            </div>

          </div>

          <div className="pt-8 border-t border-gray-900 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-500 gap-4">
            <div>© {new Date().getFullYear()} Cloudlead Inc. All rights reserved.</div>
            <div className="flex items-center gap-6">
              <a href="#" className="hover:text-gray-400">Terms of Service</a>
              <a href="#" className="hover:text-gray-400">Privacy Policy</a>
              <a href="#" className="hover:text-gray-400">Security</a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
};
