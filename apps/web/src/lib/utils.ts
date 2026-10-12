import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const time = (value: string) =>
  new Date(value).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
export const date = (value: string) => new Date(value).toLocaleString('es-ES');
export const statusLabel = { healthy: 'Operativo', warning: 'Advertencia', critical: 'Crítico' };
