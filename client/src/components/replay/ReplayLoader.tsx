import { ReplayImportDropzone } from './ReplayImportDropzone';

interface ReplayLoaderProps {
  compact?: boolean;
}

export function ReplayLoader({ compact = false }: ReplayLoaderProps) {
  return <ReplayImportDropzone compact={compact} />;
}
