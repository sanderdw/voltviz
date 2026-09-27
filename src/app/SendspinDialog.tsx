import { X } from 'lucide-react';
import type { SkinDefinition, SkinType } from '../skins';

interface SendspinDialogProps {
  skin: SkinDefinition;
  activeSkin: SkinType;
  setShowSendspinDialog: (v: boolean) => void;
  sendspinUrl: string;
  setSendspinUrl: (v: string) => void;
  sendspinConnecting: boolean;
  startSendspin: () => void;
}

export default function SendspinDialog({ skin, activeSkin, setShowSendspinDialog, sendspinUrl, setSendspinUrl, sendspinConnecting, startSendspin }: SendspinDialogProps) {
  return (
    <div className={skin.dialogOverlay}>
      <div className={skin.dialog}>
        {activeSkin === 'win95' && (
          <div className="bg-[#000080] px-2 py-1 flex justify-between items-center -mx-1 -mt-1 mb-2">
            <span className="text-white text-sm font-bold">Connect to Sendspin</span>
            <button onClick={() => setShowSendspinDialog(false)} className="bg-[#c0c0c0] border border-t-white border-l-white border-b-[#808080] border-r-[#808080] px-1.5 text-black text-xs font-bold cursor-pointer">X</button>
          </div>
        )}
        {activeSkin === 'winamp' && (
          <div className="flex justify-between items-center bg-[#2a2a3a] border-b border-[#1a1a2a] -mx-5 -mt-5 mb-3 px-4 py-2">
            <h3 className="text-sm font-bold text-[#d0d0d0] uppercase tracking-wider">Connect to Sendspin</h3>
            <button onClick={() => setShowSendspinDialog(false)} className="text-[#a0a0a0] hover:text-[#d0d0d0] cursor-pointer">
              <X size={18} />
            </button>
          </div>
        )}
        {activeSkin === 'crt' && (
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-[#00ff00] uppercase tracking-[0.3em]">Connect to Sendspin</h3>
            <button onClick={() => setShowSendspinDialog(false)} className="text-[#00ff00]/50 hover:text-[#00ff00] cursor-pointer">
              <X size={18} />
            </button>
          </div>
        )}
        {activeSkin === 'modern' && (
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-light">Connect to Sendspin</h3>
            <button onClick={() => setShowSendspinDialog(false)} className="text-white/50 hover:text-white transition-colors cursor-pointer">
              <X size={20} />
            </button>
          </div>
        )}
        <p className={activeSkin === 'modern' ? 'text-white/50 text-sm' : activeSkin === 'winamp' ? 'text-[#00ff00]/60 text-sm' : activeSkin === 'crt' ? 'text-[#00ff00]/50 text-xs tracking-wide' : 'text-black text-sm'}>Enter the URL of your Sendspin server to stream synchronized audio.</p>
        <input
          type="url"
          value={sendspinUrl}
          onChange={e => setSendspinUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && sendspinUrl && !sendspinConnecting) startSendspin(); }}
          placeholder="http://homeassistant.local:8927"
          className={skin.dialogInput}
          autoFocus
        />
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setShowSendspinDialog(false)}
            className={skin.dialogButtonSecondary}
          >
            Cancel
          </button>
          <button
            onClick={() => startSendspin()}
            disabled={!sendspinUrl || sendspinConnecting}
            className={skin.dialogButtonPrimary}
          >
            {sendspinConnecting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
