import { useEffect, useMemo, useRef } from 'react';
import type { Webxdc as WebxdcAPI } from '@webxdc/types/webxdc';

import { Button } from '@/components/ui/button';
import { IMPORT_MAX_BYTES } from '@/lib/xdcFile';

type ImportFilesFilter = Parameters<WebxdcAPI<unknown>['importFiles']>[0];

interface ImportFilesPromptProps {
  /** App display name, shown in the prompt. */
  appName: string;
  /** The filter the app asked for; `null` hides the prompt. */
  request: ImportFilesFilter | null;
  /** Called with the chosen files (empty array on cancel or oversized pick). */
  onFiles: (files: File[]) => void;
}

function buildAccept(filter: ImportFilesFilter): string | undefined {
  const parts = [...(filter.extensions ?? []), ...(filter.mimeTypes ?? [])];
  return parts.length ? parts.join(',') : undefined;
}

/**
 * User-mediated `webxdc.importFiles`. The picker must be opened from a real
 * user click in this (parent) origin — a `postMessage`-triggered
 * `input.click()` has no activation — so this renders an inline prompt whose
 * button opens a hidden file input.
 */
export function ImportFilesPrompt({ appName, request, onFiles }: ImportFilesPromptProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useMemo(() => (request ? buildAccept(request) : undefined), [request]);
  const multiple = request?.multiple ?? false;

  // Reset the input whenever a new request comes in so `change` re-fires.
  useEffect(() => {
    if (inputRef.current) inputRef.current.value = '';
  }, [request]);

  if (!request) return null;

  const handleChange = () => {
    const files = Array.from(inputRef.current?.files ?? []);
    let total = 0;
    for (const f of files) {
      total += f.size;
      if (total > IMPORT_MAX_BYTES) {
        onFiles([]);
        return;
      }
    }
    onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-3 py-2 text-sm shadow-sm backdrop-blur">
      <span className="truncate">
        <span className="font-medium">{appName}</span> wants to import files
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={() => inputRef.current?.click()}>
          Choose…
        </Button>
        <Button size="sm" variant="outline" onClick={() => onFiles([])}>
          Cancel
        </Button>
      </span>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
      />
    </div>
  );
}
