'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, Plane, MapPin, Plus, NotebookPen, Upload } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import type { AddItemMode, Idea, PlannerDay, PlannerEventDraft } from '../lib/types';
import { usePlan } from '../PlanContext';
import { compressFile } from '../lib/image';

/* ------------------------------------------------------------ */
/* CONFIGURATION: default form values and recurrence options     */
/* ------------------------------------------------------------ */
const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '10:00';
const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'No recurrence' },
  { value: 'daily-count', label: 'Repeat daily for N days' },
  { value: 'daily-until-end', label: 'Repeat daily until trip ends' },
] as const;

interface AddItemModalProps {
  open: boolean;
  mode: AddItemMode;
  day?: PlannerDay;
  idea?: Idea;
  incrementMinutes: number;
  timezone: string;
  onClose: () => void;
  onSubmit: (payload: PlannerEventDraft) => void;
}

const travelModes = [
  'flight',
  'taxi',
  'rideshare',
  'bus',
  'train',
  'car',
  'boat',
  'subway',
  'tram',
  'bike',
  'walk',
  'other',
] as const;

type RecurrenceMode = (typeof RECURRENCE_OPTIONS)[number]['value'];

function buildIsoFromDateTime(day: PlannerDay | undefined, time: string) {
  if (!day) return new Date().toISOString();
  const iso = `${day.date}T${time}`;
  const date = new Date(iso);
  return date.toISOString();
}

export default function AddItemModal({
  open,
  mode,
  day,
  idea,
  incrementMinutes,
  timezone,
  onClose,
  onSubmit,
}: AddItemModalProps) {
  const [activeTab, setActiveTab] = useState<AddItemMode>('block');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [recurrence, setRecurrence] = useState<RecurrenceMode>('none');
  const [recurrenceCount, setRecurrenceCount] = useState('3');

  // Travel specific
  const [travelMode, setTravelMode] = useState<(typeof travelModes)[number]>('flight');
  const [companyName, setCompanyName] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');

  // Activity specific
  const [address, setAddress] = useState('');
  const [tags, setTags] = useState('');
  const [activityCompanyName, setActivityCompanyName] = useState('');
  const [contact, setContact] = useState('');
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const { uploadImage } = usePlan();

  useEffect(() => {
    if (!open) return;
    const ideaPrefill = idea ?? null;
    setActiveTab(mode === 'idea' ? 'activity' : mode);
    setTitle(ideaPrefill ? ideaPrefill.title : '');
    setDescription(ideaPrefill ? ideaPrefill.description ?? '' : '');
    setTravelMode('flight');
    setCompanyName('');
    setConfirmationCode('');
    setCompanyPhone('');
    if (ideaPrefill?.address) setAddress(ideaPrefill.address);
    else setAddress('');
    if (ideaPrefill?.tags?.length) setTags(ideaPrefill.tags.join(', '));
    else setTags('');
    setActivityCompanyName('');
    setContact('');
    setStartTime(DEFAULT_START_TIME);
    setEndTime(DEFAULT_END_TIME);
    setRecurrence('none');
    setRecurrenceCount('3');
    setUploadedUrls([]);
    setUploadError('');
  }, [idea, mode, open]);

  const tabs: { id: AddItemMode; label: string; icon: React.ElementType }[] = useMemo(
    () => [
      { id: 'block', label: 'Block Time', icon: Clock3 },
      { id: 'travel', label: 'Travel', icon: Plane },
      { id: 'idea', label: 'Activity from List', icon: MapPin },
      { id: 'activity', label: 'New Activity', icon: NotebookPen },
    ],
    []
  );

  useEffect(() => {
    if (mode !== 'idea') {
      setActiveTab(mode);
    }
  }, [mode]);

  if (!open) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!day) return;
    const startISO = buildIsoFromDateTime(day, startTime);
    const endISO = buildIsoFromDateTime(day, endTime);
    const payload: PlannerEventDraft = {
      type: activeTab === 'idea' ? 'activity' : activeTab,
      dayId: day.id,
      title,
      notes: description,
      start: startISO,
      end: endISO,
      timezone,
      recurrence:
        recurrence === 'none'
          ? { mode: 'none' }
          : recurrence === 'daily-count'
          ? { mode: 'daily-count', count: Number(recurrenceCount) || 1 }
          : { mode: 'daily-until-end' },
      metadata:
        activeTab === 'travel'
          ? {
              travelMode,
              companyName,
              confirmationCode,
              companyPhone,
            }
          : activeTab === 'activity'
          ? {
              address,
              tags: tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
              companyName: activityCompanyName,
              contact,
            }
          : {},
      images: uploadedUrls,
      ideaId: idea?.id,
    };
    onSubmit(payload);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    setUploadError('');
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const compressedBlob = await compressFile(file);
        const normalizedName = file.name.replace(/\.[^/.]+$/, '') || 'upload';
        const compressedFile = new File([compressedBlob], `${normalizedName}.jpg`, { type: 'image/jpeg' });
        const url = await uploadImage(compressedFile, { alreadyCompressed: true });
        urls.push(url);
      }
      setUploadedUrls((prev) => [...prev, ...urls]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
      <div className="w-full max-w-3xl rounded-xl3 border border-border bg-surface-1 shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold">Add itinerary item</h2>
            <p className="text-sm text-text-3">{day ? `Target day: ${day.date}` : 'Select a day to continue.'}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </header>
        <div className="border-b border-border/60 px-6 py-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`rounded-lg px-3 py-2 text-sm transition-colors focus-ring ${
                  activeTab === id
                    ? 'bg-accent text-bg shadow-glow'
                    : 'bg-surface-2 text-text-2 hover:bg-surface-3'
                }`}
                onClick={() => setActiveTab(id)}
              >
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center">
                  <Icon size={16} />
                </span>
                {label}
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-6 px-6 py-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Sunrise hike"
            />
            <Select
              label="Recurrence"
              value={recurrence}
              onChange={(event) => setRecurrence(event.target.value as RecurrenceMode)}
            >
              {RECURRENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {recurrence === 'daily-count' && (
              <Input
                label="Number of days"
                type="number"
                min={1}
                value={recurrenceCount}
                onChange={(event) => setRecurrenceCount(event.target.value)}
              />
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Start time"
              type="time"
              step={incrementMinutes * 60}
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
            <Input
              label="End time"
              type="time"
              step={incrementMinutes * 60}
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </div>

          <div className="grid gap-4">
            <label className="flex flex-col text-sm font-medium text-text-2">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-2 min-h-[120px] rounded-lg border border-border bg-surface-2 px-4 py-3 text-text shadow-sm focus-ring"
                placeholder="Notes, packing reminders, or vendor details"
              />
            </label>
          </div>

          {activeTab === 'travel' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Travel mode"
                value={travelMode}
                onChange={(event) => setTravelMode(event.target.value as (typeof travelModes)[number])}
              >
                {travelModes.map((modeValue) => (
                  <option key={modeValue} value={modeValue}>
                    {modeValue.charAt(0).toUpperCase() + modeValue.slice(1)}
                  </option>
                ))}
              </Select>
              <Input
                label="Company name"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Airline, rideshare, etc."
              />
              <Input
                label="Confirmation code"
                value={confirmationCode}
                onChange={(event) => setConfirmationCode(event.target.value)}
                placeholder="ABC123"
              />
              <Input
                label="Company phone"
                value={companyPhone}
                onChange={(event) => setCompanyPhone(event.target.value)}
                placeholder="+1 (555) 555-5555"
              />
              <label className="flex flex-col text-sm font-medium text-text-2 sm:col-span-2">
                Upload confirmations
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="mt-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-text focus-ring"
                />
              </label>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="123 Main St"
              />
              <Input
                label="Tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="food, outdoors"
              />
              <Input
                label="Company name"
                value={activityCompanyName}
                onChange={(event) => setActivityCompanyName(event.target.value)}
                placeholder="Venue or host"
              />
              <Input
                label="Point of contact"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="Host name or phone"
              />
              <label className="flex flex-col text-sm font-medium text-text-2">
                Reference images
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="mt-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-text focus-ring"
                />
              </label>
            </div>
          )}

          {uploadedUrls.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-surface-2/70 p-4 text-sm text-text-2">
              <p className="flex items-center gap-2 text-text">
                <Upload size={16} /> Uploaded attachments
              </p>
              <ul className="mt-2 space-y-1 text-xs break-all text-text-3">
                {uploadedUrls.map((url) => (
                  <li key={url}>{url}</li>
                ))}
              </ul>
            </div>
          )}

          {uploadError && (
            <p className="rounded-lg border border-error/40 bg-error/10 px-4 py-2 text-sm text-error">
              {uploadError}
            </p>
          )}

          {uploading && (
            <p className="text-sm text-text-3">Uploading… please keep this tab open.</p>
          )}

          {mode === 'idea' && idea && (
            <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm text-accent">
              Using idea: <strong>{idea.title}</strong>
              {idea.tags?.length ? ` · Tags: ${idea.tags.join(', ')}` : null}
            </div>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            <p className="text-sm text-text-3">All times are saved in {timezone.replace('_', ' ')}.</p>
            <div className="flex gap-3">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" className="inline-flex items-center gap-2" disabled={uploading}>
                <Plus size={16} /> Save item
              </Button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
