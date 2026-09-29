// Take a photo with this device's camera (a desk, a shelf, a receipt) and add it to the next message.
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../components/Sheet';
import { frameToFile, stamp } from '../lib/capture';

export function CameraSheet({ onTake, onClose }: { onTake: (file: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let gone = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().then(() => setReady(true));
        }
      })
      .catch(() => setError('The camera could not be opened. Allow it in the browser’s address bar, or share a photo from your files.'));
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const take = async () => {
    if (!video.current) return;
    try {
      onTake(await frameToFile(video.current, `Photo ${stamp()}.jpg`));
      onClose();
    } catch {
      setError('The photo could not be taken. Try again.');
    }
  };
  // On the page itself: the composer's dock is its own stacking layer.
  return createPortal(
    <Sheet title="Take a photo" onClose={onClose}>
      <div class="camera">
        <video ref={video} class="camera-view" muted playsInline aria-label="What the camera sees" />
        {error ? (
          <p class="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p class="page-fine">{ready ? 'It goes with your next message, and is kept on the Memory page.' : 'Opening the camera…'}</p>
        )}
        <div class="camera-actions">
          <button type="button" class="button-primary" disabled={!ready} onClick={() => void take()}>
            Take photo
          </button>
          <button type="button" class="button-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Sheet>,
    document.body,
  );
}
