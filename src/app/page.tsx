import Link from 'next/link';
import { Camera, ClipboardCheck, Zap } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-navy-900 flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/30 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/30 blur-[120px] rounded-full pointer-events-none" />

      <main className="z-10 flex flex-col items-center max-w-5xl px-6 text-center animate-fade-in">
        <div className="inline-block px-4 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md mb-8 text-sm text-blue-300 font-medium tracking-wide">
          Next-Gen OMR Scanner
        </div>
        
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 leading-tight">
          Grade Exams in <br /> Milliseconds.
        </h1>
        
        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mb-12">
          ExamFlow enables teachers to generate personalized printable answer sheets, scan them using a phone camera, and sync grades to a live dashboard instantly.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mb-24 w-full justify-center">
          <Link
            href="/auth/signup"
            className="px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-lg hover:brightness-110 transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] focus:ring-4 focus:ring-blue-500/50 outline-none"
          >
            Get Started
          </Link>
          <Link
            href="/auth/login"
            className="px-8 py-4 rounded-xl bg-white/5 border border-white/10 text-white font-semibold text-lg hover:bg-white/10 transition-all focus:ring-4 focus:ring-white/20 outline-none"
          >
            Sign In
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full text-left">
          <div className="glass-card p-6">
            <div className="w-12 h-12 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center mb-4">
              <ClipboardCheck size={24} />
            </div>
            <h3 className="text-xl font-semibold mb-2">Create & Print</h3>
            <p className="text-gray-400 text-sm">
              Build answer keys and generate pre-filled answer sheets for every student in your roster with auto-generated alignment markers.
            </p>
          </div>
          
          <div className="glass-card p-6">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
              <Camera size={24} />
            </div>
            <h3 className="text-xl font-semibold mb-2">Scan & Grade</h3>
            <p className="text-gray-400 text-sm">
              Use your phone's camera to scan sheets. Our OpenCV.js engine detects bubbles and calculates scores instantly, even on older devices.
            </p>
          </div>
          
          <div className="glass-card p-6">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
              <Zap size={24} />
            </div>
            <h3 className="text-xl font-semibold mb-2">Real-time Sync</h3>
            <p className="text-gray-400 text-sm">
              Scores are immediately synced to your laptop's master gradebook via Supabase Realtime the millisecond you finish scanning.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
