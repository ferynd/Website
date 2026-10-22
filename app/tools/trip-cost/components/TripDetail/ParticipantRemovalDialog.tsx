"use client";

import React from 'react';
import Button from '@/components/Button';
import Dialog from '../ui/Dialog';

interface ParticipantRemovalDialogProps {
  name: string;
  blockers: string[];
  onClose: () => void;
}

/** The shared dialog scrolls its body while keeping both close controls visible. */
export default function ParticipantRemovalDialog({ name, blockers, onClose }: ParticipantRemovalDialogProps) {
  return (
    <Dialog
      open
      title={`Can't remove ${name} yet`}
      onClose={onClose}
      footer={<Button type="button" onClick={onClose}>Close</Button>}
    >
      <p className="text-text-2">Remove or reassign these records first:</p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-text-2">
        {blockers.map((blocker, index) => (
          <li key={index} className="break-words [overflow-wrap:anywhere]">{blocker}</li>
        ))}
      </ul>
    </Dialog>
  );
}
