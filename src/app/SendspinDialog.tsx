import { X } from 'lucide-react';
import type { SkinDefinition } from '../skins';

interface SendspinDialogProps {
  skin: SkinDefinition;
  setShowSendspinDialog: (v: boolean) => void;
  sendspinUrl: string;
  setSendspinUrl: (v: string) => void;
  sendspinConnecting: boolean;
  startSendspin: () => void;
}

export default function SendspinDialog({ skin, setShowSendspinDialog, sendspinUrl, setSendspinUrl, sendspinConnecting, startSendspin }: SendspinDialogProps) {
  return (
    <div className={skin.dialogOverlay}>
      <div className={skin.dialog}>
        <div className={skin.dialogHeader}>
          <h3 className={skin.dialogTitle}>Connect to Sendspin</h3>
          <button onClick={() => setShowSendspinDialog(false)} aria-label="Close" className={skin.dialogClose}>
            {skin.dialogCloseIcon ? <X className={skin.dialogCloseIcon} /> : 'X'}
          </button>
        </div>
        <p className={skin.dialogText}>Enter the URL of your Sendspin server to stream synchronized audio.</p>
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
