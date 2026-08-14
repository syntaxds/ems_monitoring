import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAvailableShiftUnits, getMyActiveShift, submitShiftLog, endShiftLog } from '../services/api';
import Icon from '../components/ui/Icon';
import { PageHeader, Field, TextInput, SelectInput } from '../components/ui';

function localDateTimeValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_START_FORM = {
  device_id: '',
  start_time: localDateTimeValue(),
  fuel_initial: '',
  hour_meter: '',
};

const EMPTY_END_FORM = {
  end_time: localDateTimeValue(),
  fuel_final: '',
  hour_meter_final: '',
};

// Opens the device camera through getUserMedia and lets the driver snap a
// live frame — there is no file-picker fallback here (on desktop or mobile),
// since photo proof must come straight from the camera, never an existing
// image on disk.
function CameraCaptureModal({ onCancel, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access isn\'t available in this browser, or this page isn\'t loaded over a secure (HTTPS) connection.');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setReady(true);
      } catch (e) {
        if (cancelled) return;
        setError(
          e?.name === 'NotAllowedError'
            ? 'Camera access was denied. Allow camera access for this site in your browser settings, then try again.'
            : e?.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : 'Could not access the camera. Please try again.'
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvasRef.current = canvas;
    setSnapshot(canvas.toDataURL('image/jpeg', 0.92));
    stopStream();
  };

  const retake = async () => {
    setSnapshot(null);
    setError('');
    setReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setReady(true);
    } catch (e) {
      setError('Could not access the camera. Please try again.');
    }
  };

  const confirm = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `shift_${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92
    );
  };

  const close = () => {
    stopStream();
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md bg-bg border border-line rounded-card shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Take photo</h2>
          <button type="button" onClick={close} className="btn btn-icon btn-ghost">
            <Icon name="x" size={15} />
          </button>
        </div>

        {error ? (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-btn text-[13px] bg-bad/15 text-bad">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="rounded-btn overflow-hidden bg-black aspect-video flex items-center justify-center">
            {snapshot ? (
              // eslint-disable-next-line jsx-a11y/img-redundant-alt
              <img src={snapshot} alt="Captured photo preview" className="w-full h-full object-contain" />
            ) : (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {error ? (
            <button type="button" onClick={close} className="btn btn-ghost">Close</button>
          ) : snapshot ? (
            <>
              <button type="button" onClick={retake} className="btn btn-ghost">
                <Icon name="refresh" size={12} />
                Retake
              </button>
              <button type="button" onClick={confirm} className="btn btn-primary">
                <Icon name="check" size={13} />
                Use Photo
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={close} className="btn btn-ghost">Cancel</button>
              <button type="button" disabled={!ready} onClick={capture} className="btn btn-primary">
                <Icon name="camera" size={13} />
                Capture
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PhotoField({ label, hint, photo, onCapture }) {
  const [open, setOpen] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2.5">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          <Icon name="camera" size={13} />
          {photo ? 'Retake photo' : 'Take photo'}
        </button>
        {photo && <span className="text-[12.5px] text-ink2 truncate max-w-[180px]">{photo.name}</span>}
      </div>
      {open && (
        <CameraCaptureModal
          onCancel={() => setOpen(false)}
          onCapture={(file) => {
            onCapture(file);
            setOpen(false);
          }}
        />
      )}
    </Field>
  );
}

export default function ShiftStart() {
  const { user } = useAuth();
  const [checking, setChecking] = useState(true);
  const [activeShift, setActiveShift] = useState(null);
  const [activeUnitName, setActiveUnitName] = useState('');

  const [units, setUnits] = useState([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [startForm, setStartForm] = useState(EMPTY_START_FORM);
  const [startPhoto, setStartPhoto] = useState(null);

  const [endForm, setEndForm] = useState(EMPTY_END_FORM);
  const [endPhoto, setEndPhoto] = useState(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadUnits = useCallback(async () => {
    setLoadingUnits(true);
    try {
      const { data } = await getAvailableShiftUnits();
      setUnits(data);
      setStartForm((f) => (f.device_id && data.some((u) => u.device_id === f.device_id) ? f : { ...f, device_id: data[0]?.device_id || '' }));
    } catch (e) {
      setUnits([]);
    } finally {
      setLoadingUnits(false);
    }
  }, []);

  const checkActive = useCallback(async () => {
    setChecking(true);
    try {
      const { data } = await getMyActiveShift();
      setActiveShift(data);
      setActiveUnitName(data?.device_name || '');
      if (!data) await loadUnits();
    } catch (e) {
      setActiveShift(null);
      await loadUnits();
    } finally {
      setChecking(false);
    }
  }, [loadUnits]);

  useEffect(() => {
    checkActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user?.role !== 'driver') {
    return <Navigate to="/overview" replace />;
  }

  const setStart = (k, v) => setStartForm((f) => ({ ...f, [k]: v }));
  const setEnd = (k, v) => setEndForm((f) => ({ ...f, [k]: v }));

  const handleCapture = (setter) => (file) => {
    if (file.type !== 'image/jpeg') {
      setError('Photo proof must be a JPEG image.');
      return;
    }
    setError('');
    setter(file);
  };

  const submitStart = async (e) => {
    e.preventDefault();
    setError('');

    if (!startForm.device_id) {
      setError('Select a unit to operate today.');
      return;
    }
    if (!startForm.start_time) {
      setError('Start time is required.');
      return;
    }
    const fuel = Number(startForm.fuel_initial);
    if (!Number.isFinite(fuel) || fuel <= 0) {
      setError('Initial fuel level must be a positive number.');
      return;
    }
    const hm = Number(startForm.hour_meter);
    if (!Number.isFinite(hm) || hm <= 0) {
      setError('Initial HM reading must be a positive number.');
      return;
    }
    if (!startPhoto) {
      setError('Photo proof (JPEG) is required.');
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('device_id', startForm.device_id);
      fd.append('start_time', new Date(startForm.start_time).toISOString());
      fd.append('fuel_initial', String(fuel));
      fd.append('hour_meter', String(hm));
      fd.append('photo', startPhoto);

      const { data } = await submitShiftLog(fd);
      const unit = units.find((u) => u.device_id === data.device_id);
      setActiveUnitName(unit?.device_name || data.device_id);
      setActiveShift(data);
      setNotice('');
      setStartForm(EMPTY_START_FORM);
      setStartPhoto(null);
    } catch (e2) {
      const msg = e2?.response?.data?.error || 'Failed to start shift. Please try again.';
      setError(msg);
      // The unit may have just been claimed by another driver — refresh the list.
      if (e2?.response?.status === 409) {
        loadUnits();
      }
    } finally {
      setBusy(false);
    }
  };

  const submitEnd = async (e) => {
    e.preventDefault();
    setError('');

    if (!endForm.end_time) {
      setError('End time is required.');
      return;
    }
    const fuel = Number(endForm.fuel_final);
    if (!Number.isFinite(fuel) || fuel <= 0) {
      setError('Final fuel level must be a positive number.');
      return;
    }
    const hm = Number(endForm.hour_meter_final);
    if (!Number.isFinite(hm) || hm <= 0) {
      setError('Final HM reading must be a positive number.');
      return;
    }
    if (!endPhoto) {
      setError('Photo proof (JPEG) is required.');
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('end_time', new Date(endForm.end_time).toISOString());
      fd.append('fuel_final', String(fuel));
      fd.append('hour_meter_final', String(hm));
      fd.append('photo', endPhoto);

      await endShiftLog(fd);
      setActiveShift(null);
      setActiveUnitName('');
      setEndForm(EMPTY_END_FORM);
      setEndPhoto(null);
      setNotice('Shift ended. The unit is now available for other drivers.');
      await loadUnits();
    } catch (e2) {
      const msg = e2?.response?.data?.error || 'Failed to end shift. Please try again.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="space-y-5">
        <PageHeader title="Shift Start" subtitle="Checking your shift status…" />
      </div>
    );
  }

  if (activeShift) {
    return (
      <div className="space-y-5">
        <PageHeader title="End Shift" subtitle="Log your final readings to release this unit." />

        <div className="card card-pad max-w-md space-y-4">
          <div className="flex items-center gap-2.5 text-ok">
            <Icon name="check" size={18} />
            <span className="text-[15px] font-semibold">On shift · {activeUnitName || activeShift.device_id}</span>
          </div>
          <div className="text-[13px] text-ink2 space-y-1.5">
            <Row label="Start time" value={new Date(activeShift.start_time).toLocaleString()} />
            <Row label="Initial fuel" value={`${activeShift.fuel_initial} L`} />
            <Row label="Initial HM" value={activeShift.hour_meter} />
          </div>
        </div>

        <div className="card card-pad max-w-md">
          <form onSubmit={submitEnd} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-btn text-[13px] bg-bad/15 text-bad">
                <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Field label="End time">
              <TextInput
                icon="clock"
                type="datetime-local"
                value={endForm.end_time}
                onChange={(e) => setEnd('end_time', e.target.value)}
              />
            </Field>

            <Field label="Final fuel level (L)">
              <TextInput
                icon="fuel"
                type="number"
                step="0.1"
                min="0"
                value={endForm.fuel_final}
                onChange={(e) => setEnd('fuel_final', e.target.value)}
                placeholder="e.g. 120"
              />
            </Field>

            <Field label="Final HM (hour meter) reading">
              <TextInput
                icon="activity"
                type="number"
                step="0.1"
                min="0"
                value={endForm.hour_meter_final}
                onChange={(e) => setEnd('hour_meter_final', e.target.value)}
                placeholder="e.g. 4329.0"
              />
            </Field>

            <PhotoField
              label="Photo proof (JPEG)"
              hint="Take a live photo of the unit before ending your shift."
              photo={endPhoto}
              onCapture={handleCapture(setEndPhoto)}
            />

            <div className="flex items-center justify-end pt-2">
              <button type="submit" disabled={busy} className="btn btn-primary">
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    Ending shift
                  </span>
                ) : (
                  'End Shift'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Shift Start"
        subtitle="Claim your unit and log your starting readings before going on shift."
      />

      {notice && (
        <div className="max-w-md flex items-start gap-2 px-3 py-2.5 rounded-btn text-[13px] bg-ok/12 text-ok">
          <Icon name="check" size={13} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="card card-pad max-w-md">
        <form onSubmit={submitStart} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-btn text-[13px] bg-bad/15 text-bad">
              <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Field label="Unit" hint={loadingUnits ? 'Loading available units…' : `${units.length} unit(s) available now`}>
            <SelectInput
              value={startForm.device_id}
              onChange={(e) => setStart('device_id', e.target.value)}
              disabled={loadingUnits || units.length === 0}
            >
              {units.length === 0 && <option value="">No units available</option>}
              {units.map((u) => (
                <option key={u.device_id} value={u.device_id}>
                  {u.device_name} ({u.device_id})
                </option>
              ))}
            </SelectInput>
          </Field>

          <Field label="Start time">
            <TextInput
              icon="clock"
              type="datetime-local"
              value={startForm.start_time}
              onChange={(e) => setStart('start_time', e.target.value)}
            />
          </Field>

          <Field label="Initial fuel level (L)">
            <TextInput
              icon="fuel"
              type="number"
              step="0.1"
              min="0"
              value={startForm.fuel_initial}
              onChange={(e) => setStart('fuel_initial', e.target.value)}
              placeholder="e.g. 180"
            />
          </Field>

          <Field label="Initial HM (hour meter) reading">
            <TextInput
              icon="activity"
              type="number"
              step="0.1"
              min="0"
              value={startForm.hour_meter}
              onChange={(e) => setStart('hour_meter', e.target.value)}
              placeholder="e.g. 4321.5"
            />
          </Field>

          <PhotoField
            label="Photo proof (JPEG)"
            hint="Take a live photo of the unit before starting."
            photo={startPhoto}
            onCapture={handleCapture(setStartPhoto)}
          />

          <div className="flex items-center justify-end pt-2">
            <button type="submit" disabled={busy || units.length === 0} className="btn btn-primary">
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Starting shift
                </span>
              ) : (
                'Start Shift'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink3">{label}</span>
      <span className="text-ink font-medium">{value}</span>
    </div>
  );
}
