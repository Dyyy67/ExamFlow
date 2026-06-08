'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle, AlertTriangle, X, Loader2 } from 'lucide-react';
import { Button, Card, useToast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { OpenCVEngine } from '@/lib/scanner/OpenCVEngine';

declare global {
  interface Window {
    cv: any;
  }
}

export default function ScannerPage() {
  const { user } = useSupabaseAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const supabase = createClient();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [cvLoaded, setCvLoaded] = useState(false);
  const [engine, setEngine] = useState<OpenCVEngine | null>(null);
  const [aspectRatioMode, setAspectRatioMode] = useState<'auto' | '4:3' | '3:2'>('auto');

  // Load OpenCV
  useEffect(() => {
    if (window.cv && window.cv.Mat) {
      setCvLoaded(true);
      setEngine(new OpenCVEngine(window.cv));
      return;
    }

    if (document.getElementById('opencv-script')) {
      // Script is already in DOM, just wait for it to initialize
      const checkCv = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          clearInterval(checkCv);
          setCvLoaded(true);
          setEngine(new OpenCVEngine(window.cv));
        }
      }, 100);
      return () => clearInterval(checkCv);
    }

    const script = document.createElement('script');
    script.id = 'opencv-script';
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    
    const checkCv = setInterval(() => {
      if (window.cv && window.cv.Mat) {
        clearInterval(checkCv);
        setCvLoaded(true);
        setEngine(new OpenCVEngine(window.cv));
      }
    }, 100);

    document.body.appendChild(script);

    return () => {
      clearInterval(checkCv);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startCamera = async (mode: 'auto' | '4:3' | '3:2' = aspectRatioMode) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      let videoConstraints: MediaTrackConstraints = { facingMode: { ideal: 'environment' } };
      videoConstraints.width = { ideal: 4096 };
      
      // Log supported resolutions
      try {
        const capabilities = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = capabilities.filter(device => device.kind === 'videoinput');
        console.log('Available video devices:', videoDevices);
        
        if (navigator.mediaDevices.getSupportedConstraints) {
          const supported = navigator.mediaDevices.getSupportedConstraints();
          console.log('Supported constraints:', supported);
        }
      } catch (e) {
        console.log('Could not enumerate devices:', e);
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints
      });
      
      // Log actual video track capabilities
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        console.log('Actual camera resolution:', {
          width: settings.width,
          height: settings.height,
          aspectRatio: settings.aspectRatio,
          facingMode: settings.facingMode
        });
        
        // Show resolution in toast for user feedback
        addToast('info', `Camera: ${settings.width}x${settings.height} (${settings.facingMode})`);
      }

      if (!videoRef.current) return;

      const video = videoRef.current;
      video.srcObject = stream;
      streamRef.current = stream;

      // Explicitly play and wait — critical for iOS Safari & Android Chrome
      await video.play().catch(() => {
        // play() may throw on some browsers if not triggered by user gesture,
        // but since we're inside a button click handler, it should succeed.
      });

      // Only flip UI to "camera ready" AFTER the video is actually playing
      setIsReady(true);
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        addToast('error', 'Camera permission denied. Please allow camera access in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        addToast('error', 'No camera found on this device.');
      } else {
        addToast('error', 'Could not access camera: ' + err.message);
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setIsReady(false);
    }
  };

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current || !engine) return;

    setIsScanning(true);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      setIsScanning(false);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // First pass: try to decode QR + detect paper using just the imageData
    // We pass a dummy answer key initially — the engine checks QR and paper first
    // We need *some* answer key for the mock grading, so we fetch it based on QR result

    // Quick QR-only check first
    const qrCheck = engine.decodeQR(imageData);
    if (!qrCheck) {
      addToast('error', 'Could not read QR code. Make sure the QR code on the answer sheet is clearly visible.');
      setIsScanning(false);
      return;
    }

    // Look up the exam from the QR code
    const { data: examData, error: examError } = await supabase
      .from('exams')
      .select('*')
      .eq('id', qrCheck.examId)
      .single();

    if (examError || !examData) {
      addToast('error', 'Exam not found. The QR code may belong to a different account.');
      setIsScanning(false);
      return;
    }

    // Look up the student from the QR code
    const { data: studentData, error: studentError } = await supabase
      .from('students')
      .select('*')
      .eq('id', qrCheck.studentId)
      .single();

    if (studentError || !studentData) {
      addToast('error', 'Student not found. The QR code may belong to a different roster.');
      setIsScanning(false);
      return;
    }

    // Process Image (paper detection + mock grading)
    const result = engine.processImage(imageData, examData.answer_key);

    if (result.success) {
      // Save to Supabase
      const { error } = await supabase.from('submissions').upsert({
        exam_id: examData.id,
        student_id: studentData.id,
        score: result.score,
        total_scannable_score: result.total,
        item_breakdown: result.breakdown,
        scanned_at: new Date().toISOString()
      }, { onConflict: 'exam_id,student_id' });

      if (error) {
        addToast('error', 'Failed to save submission: ' + error.message);
      } else {
        setScanResult({
          score: result.score,
          total: result.total,
          studentName: studentData.name,
          examTitle: examData.title
        });
      }
    } else {
      addToast('error', result.error || 'Could not detect answer sheet. Please align markers within the frame.');
    }

    setIsScanning(false);
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center relative p-4">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-center z-20">
        <Button variant="ghost" onClick={() => router.push('/dashboard')} className="text-white hover:bg-white/10">
          <X size={24} />
        </Button>
        <div className="flex gap-2 items-center">
          {isReady && (
            <Button 
              variant="secondary" 
              size="sm" 
              className="text-xs bg-white/10 text-white border-white/20 backdrop-blur"
              onClick={() => {
                const nextMode = aspectRatioMode === 'auto' ? '4:3' : (aspectRatioMode === '4:3' ? '3:2' : 'auto');
                setAspectRatioMode(nextMode);
                startCamera(nextMode);
              }}
            >
              {aspectRatioMode === 'auto' ? 'Auto' : aspectRatioMode}
            </Button>
          )}
          <div className="px-4 py-1.5 rounded-full bg-white/10 backdrop-blur text-sm text-white flex items-center gap-2">
            {cvLoaded ? (
               <><div className="w-2 h-2 rounded-full bg-emerald-500" /> OpenCV Ready</>
            ) : (
               <><Loader2 size={14} className="animate-spin" /> Loading Engine...</>
            )}
          </div>
        </div>
      </div>

      <div className={!isReady ? "w-full max-w-md" : "hidden"}>
        <Card className="w-full text-center p-8 bg-navy-900 border-white/10">
          <Camera size={48} className="mx-auto mb-4 text-blue-400" />
          <h2 className="text-2xl font-bold text-white mb-2">Scanner</h2>
          <p className="text-gray-400 mb-6">Position the answer sheet within the camera frame, ensuring all 4 corner markers are visible.</p>
          <Button onClick={() => startCamera()} className="w-full" disabled={!cvLoaded}>
            Start Camera
          </Button>
        </Card>
      </div>

      <div className={isReady ? "fixed inset-0 z-10 bg-black overflow-hidden" : "fixed inset-0 z-[-1] opacity-0 pointer-events-none overflow-hidden"}>
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-contain"
        />
        <canvas ref={canvasRef} className="hidden" />
          
          {/* Viewfinder overlay */}
          <div className="absolute inset-0 border-[40px] border-black/50 pointer-events-none">
            {/* Corner brackets */}
            <div className="absolute top-4 left-4 w-12 h-12 border-t-4 border-l-4 border-blue-500" />
            <div className="absolute top-4 right-4 w-12 h-12 border-t-4 border-r-4 border-blue-500" />
            <div className="absolute bottom-4 left-4 w-12 h-12 border-b-4 border-l-4 border-blue-500" />
            <div className="absolute bottom-4 right-4 w-12 h-12 border-b-4 border-r-4 border-blue-500" />
          </div>

          {/* Controls */}
          <div className="absolute bottom-8 left-0 w-full flex justify-center z-20">
            <button 
              onClick={handleCapture}
              disabled={isScanning}
              className="w-20 h-20 rounded-full border-4 border-white/50 flex items-center justify-center p-1 bg-transparent hover:bg-white/10 transition-colors disabled:opacity-50 focus:outline-none"
            >
              <div className={`w-full h-full rounded-full bg-white transition-all ${isScanning ? 'scale-75' : 'scale-100'}`} />
            </button>
          </div>
        </div>

      {/* Result Overlay */}
      {scanResult && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <Card className="max-w-sm w-full text-center bg-navy-800 border-white/10 transform scale-110">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} />
            </div>
            <h3 className="text-3xl font-bold text-white mb-1">
              {scanResult.score} <span className="text-xl text-gray-400">/ {scanResult.total}</span>
            </h3>
            <p className="text-emerald-400 font-medium mb-4">{(scanResult.score / scanResult.total * 100).toFixed(1)}%</p>
            
            <div className="bg-white/5 rounded-xl p-4 mb-6 text-left border border-white/5">
              <p className="text-gray-400 text-sm">Student</p>
              <p className="text-white font-medium mb-2">{scanResult.studentName}</p>
              <p className="text-gray-400 text-sm">Exam</p>
              <p className="text-white font-medium">{scanResult.examTitle}</p>
            </div>

            <div className="flex gap-3">
              <Button onClick={() => setScanResult(null)} className="flex-1">
                Scan Next
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
