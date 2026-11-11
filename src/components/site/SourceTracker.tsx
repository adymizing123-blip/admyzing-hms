'use client';
import { useEffect } from 'react';
import { rememberVisitSource } from '@/lib/visit-source';

export default function SourceTracker() {
  useEffect(() => { rememberVisitSource(); }, []);
  return null;
}
