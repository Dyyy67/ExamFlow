'use client';

import { useState, useEffect } from 'react';
import { Save, Key, Trash2, Eye, EyeOff, CheckCircle2, Plus, Copy, Check, AlertCircle, Zap } from 'lucide-react';
import { Button, Input, Card, Select, useToast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';

export default function SettingsPage() {
  const { user } = useSupabaseAuth();
  const { addToast } = useToast();
  const supabase = createClient();
  
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [geminiKeys, setGeminiKeys] = useState<string[]>(['']);
  const [mistralKeys, setMistralKeys] = useState<string[]>(['']);
  const [groqKeys, setGroqKeys] = useState<string[]>(['']);
  const [openrouterKeys, setOpenrouterKeys] = useState<string[]>(['']);
  const [preferredProvider, setPreferredProvider] = useState<'gemini'|'mistral'|'groq'|'openrouter'>('gemini');
  
  // Active key selection per provider (which key to use primarily)
  const [activeKeyIndices, setActiveKeyIndices] = useState<Record<string, number>>({
    gemini: 0,
    mistral: 0,
    groq: 0,
    openrouter: 0
  });

  // Track initial state to detect unsaved changes
  const [initialState, setInitialState] = useState<any>(null);

  useEffect(() => {
    if (user) {
      loadProfile();
    }
  }, [user]);

  const getCurrentState = () => ({
    gemini: geminiKeys.join(','),
    mistral: mistralKeys.join(','),
    groq: groqKeys.join(','),
    openrouter: openrouterKeys.join(','),
    preferred: preferredProvider,
    activeIndices: activeKeyIndices
  });

  useEffect(() => {
    if (loading || !initialState) return;

    const currentState = getCurrentState();
    const hasUnsavedChanges = JSON.stringify(currentState) !== JSON.stringify(initialState);

    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have unsaved settings changes. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [geminiKeys, mistralKeys, groqKeys, openrouterKeys, preferredProvider, initialState, loading]);

  async function loadProfile() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user?.id)
      .single();

    if (error) {
      addToast('error', 'Failed to load profile settings');
    } else {
      const splitKeys = (val: string | undefined | null) => {
        const arr = val ? val.split(',').map(k => k.trim()).filter(k => k.length > 0) : [];
        return arr.length > 0 ? arr : [''];
      };
      
      const gKeys = splitKeys(data.gemini_key);
      const mKeys = splitKeys(data.mistral_key);
      const grKeys = splitKeys(data.groq_key);
      const oKeys = splitKeys(data.openrouter_key);
      const pref = data.preferred_provider || 'gemini';

      setGeminiKeys(gKeys);
      setMistralKeys(mKeys);
      setGroqKeys(grKeys);
      setOpenrouterKeys(oKeys);
      setPreferredProvider(pref);

      setInitialState({
        gemini: gKeys.join(','),
        mistral: mKeys.join(','),
        groq: grKeys.join(','),
        openrouter: oKeys.join(','),
        preferred: pref,
        activeIndices: {
          gemini: 0,
          mistral: 0,
          groq: 0,
          openrouter: 0
        }
      });
    }
    setLoading(false);
  }

  const copyToClipboard = (text: string, keyId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyId);
    addToast('success', 'Copied to clipboard!');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    const joinKeys = (arr: string[]) => arr.map(k => k.trim()).filter(k => k.length > 0).join(',');

    const updates = {
      gemini_key: joinKeys(geminiKeys),
      mistral_key: joinKeys(mistralKeys),
      groq_key: joinKeys(groqKeys),
      openrouter_key: joinKeys(openrouterKeys),
      preferred_provider: preferredProvider
    };

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user?.id);

    setIsSaving(false);
    if (error) {
      addToast('error', 'Failed to save settings: ' + error.message);
    } else {
      addToast('success', 'Settings saved successfully!');
      setInitialState({
        gemini: updates.gemini_key,
        mistral: updates.mistral_key,
        groq: updates.groq_key,
        openrouter: updates.openrouter_key,
        preferred: updates.preferred_provider,
        activeIndices: activeKeyIndices
      });
    }
  };

  const renderProviderBlock = (
    providerId: 'gemini' | 'mistral' | 'groq' | 'openrouter',
    title: string,
    keys: string[],
    setKeysAction: (val: string[]) => void,
    placeholder: string,
    helperText?: string,
    docsLink?: string
  ) => {
    const updateKey = (index: number, val: string) => {
      const newKeys = [...keys];
      newKeys[index] = val;
      setKeysAction(newKeys);
    };

    const removeKey = (index: number) => {
      const newKeys = [...keys];
      newKeys.splice(index, 1);
      if (newKeys.length === 0) newKeys.push('');
      setKeysAction(newKeys);
      
      // If we removed the active key, reset active index
      if (activeKeyIndices[providerId] >= newKeys.length) {
        setActiveKeyIndices({
          ...activeKeyIndices,
          [providerId]: Math.max(0, newKeys.length - 1)
        });
      }
    };

    const addKey = () => {
      setKeysAction([...keys, '']);
    };

    const setActiveKey = (index: number) => {
      setActiveKeyIndices({
        ...activeKeyIndices,
        [providerId]: index
      });
    };

    const isPreferred = preferredProvider === providerId;
    const validKeys = keys.filter(k => k.trim().length > 0);
    const activeKeyIndex = activeKeyIndices[providerId];
    const activeKey = validKeys[activeKeyIndex] || (validKeys.length > 0 ? validKeys[0] : null);

    return (
      <div className={`p-6 rounded-2xl border transition-all ${isPreferred ? 'bg-gradient-to-br from-blue-900/20 to-blue-800/10 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'bg-white/5 border-white/10'}`}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              {isPreferred && <Zap size={18} className="text-yellow-400 animate-pulse" />}
              {title}
            </h3>
            {validKeys.length > 0 && (
              <p className="text-sm text-gray-400 mt-1">
                {validKeys.length} key{validKeys.length !== 1 ? 's' : ''} configured
              </p>
            )}
            {docsLink && (
              <a href={docsLink} target="_blank" rel="noopener noreferrer" className="inline-block mt-2">
                <Button type="button" variant="ghost" size="sm" className="text-blue-400 hover:text-blue-300 flex items-center gap-1.5 px-0">
                  <span className="text-xs">→ Get API Key</span>
                </Button>
              </a>
            )}
          </div>
          <Button 
            type="button" 
            variant={isPreferred ? "primary" : "secondary"} 
            size="sm" 
            onClick={() => setPreferredProvider(providerId)}
            className={`whitespace-nowrap ${isPreferred ? 'pointer-events-none opacity-75' : ''}`}
          >
            {isPreferred ? "✓ Active Provider" : "Set as Primary"}
          </Button>
        </div>
        
        <div className="space-y-3">
          {validKeys.length > 0 && (
            <div className="mb-4 p-3 bg-white/5 rounded-lg border border-white/10">
              <p className="text-xs text-gray-400 mb-2">Active Key (Currently Used)</p>
              <Select
                value={activeKeyIndex.toString()}
                onChange={(e) => setActiveKey(parseInt(e.target.value))}
                options={validKeys.map((key, idx) => ({
                  value: idx.toString(),
                  label: `Key ${idx + 1}: ${key.substring(0, 12)}${key.length > 12 ? '...' : ''}`
                }))}
              />
            </div>
          )}

          {keys.map((k, idx) => (
            <div key={idx} className={`p-3 rounded-lg border transition-all ${
              idx === activeKeyIndex && k.trim() 
                ? 'bg-blue-900/20 border-blue-500/50' 
                : 'bg-white/5 border-white/10'
            }`}>
              <div className="flex gap-3 items-start mb-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1 block">
                    Key {idx + 1} {idx === activeKeyIndex && k.trim() && <span className="text-blue-400 font-semibold">(Active)</span>}
                  </label>
                  <Input
                    type={showKeys ? "text" : "password"}
                    placeholder={placeholder}
                    value={k}
                    onChange={(e) => updateKey(idx, e.target.value)}
                  />
                </div>
                {k.trim() && (
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="md" 
                    onClick={() => copyToClipboard(k, `${providerId}-${idx}`)}
                    className="px-2.5 shrink-0 mt-6"
                    title="Copy to clipboard"
                  >
                    {copiedKey === `${providerId}-${idx}` ? (
                      <Check size={16} className="text-green-400" />
                    ) : (
                      <Copy size={16} className="text-gray-400" />
                    )}
                  </Button>
                )}
                <Button 
                  type="button" 
                  variant="danger" 
                  size="md" 
                  onClick={() => removeKey(idx)} 
                  className="px-2.5 shrink-0 mt-6"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={addKey} className="text-blue-400 flex items-center gap-2">
            <Plus size={16} /> Add Key
          </Button>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="animate-pulse p-8"><div className="h-8 w-64 bg-white/10 rounded mb-8"></div></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl pb-20">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings & API Keys</h1>
          <p className="text-gray-400 text-sm">Configure your personal AI providers. Add multiple keys to avoid rate limits.</p>
        </div>
      </header>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Key size={20} className="text-blue-400" />
              AI Provider Keys
            </h2>
            <Button 
              type="button" 
              variant="ghost" 
              size="sm" 
              onClick={() => setShowKeys(!showKeys)}
              className="text-gray-400"
            >
              {showKeys ? <><EyeOff size={16} className="mr-2" /> Hide Keys</> : <><Eye size={16} className="mr-2" /> Show Keys</>}
            </Button>
          </div>
          
          <p className="text-sm text-gray-400 mb-6 bg-blue-900/20 p-4 rounded-xl border border-blue-500/20">
            <strong>Pro Tip:</strong> Free tiers often have strict requests-per-minute limits. Adding multiple keys for your selected provider will automatically rotate them behind the scenes to help you scan large batches without interruptions!
          </p>

          <div className="space-y-5">
            {renderProviderBlock(
              'gemini', 
              'Google Gemini (Recommended)', 
              geminiKeys, 
              setGeminiKeys, 
              'AIzaSy...', 
              'Get free keys from Google AI Studio',
              'https://aistudio.google.com/apikey'
            )}

            {renderProviderBlock(
              'mistral', 
              'Mistral AI', 
              mistralKeys, 
              setMistralKeys, 
              'sk-...',
              'Get from Mistral Console',
              'https://console.mistral.ai/api-keys/'
            )}

            {renderProviderBlock(
              'groq', 
              'Groq (Ultra-fast)', 
              groqKeys, 
              setGroqKeys, 
              'gsk_...',
              'Free API with generous limits',
              'https://console.groq.com/keys'
            )}

            {renderProviderBlock(
              'openrouter', 
              'OpenRouter', 
              openrouterKeys, 
              setOpenrouterKeys, 
              'sk-or-v1-...',
              'Unified API access',
              'https://openrouter.ai/keys'
            )}
          </div>
        </Card>

        <div className="flex justify-end sticky bottom-6 z-10">
          <Button type="submit" loading={isSaving} className="gap-2 shadow-lg shadow-blue-500/20 px-6">
            <Save size={18} /> Save All Settings
          </Button>
        </div>
      </form>
    </div>
  );
}
